import React, { useState, useEffect, useRef, ReactNode, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, ClipboardList, UtensilsCrossed, LogOut, 
  Settings, CheckCircle2, Check, Info, Loader2, Upload, 
  FileDown, Trash2, Sparkles, User as UserIcon, AlertCircle,
  ChevronLeft, ChevronRight, Search, Plus, Save, FileText
} from 'lucide-react';
import { 
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, 
  onSnapshot, query, where, orderBy, writeBatch, Timestamp, 
  limit, getDocs 
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

// ==========================================
// 1. 型定義 (原型のデータ構造を厳守)
// ==========================================
interface User {
  id: string;
  username?: string;
  name: string;
  role: 'admin' | 'student';
  createdAt?: any;
}

interface MenuItem {
  id?: string;
  date: string;
  title: string;
  meal_type: 'lunch' | 'dinner';
  description?: string;
  calories?: number;
  createdAt?: any;
}

interface Reservation {
  id: string;
  user_id: string;
  user_name: string;
  menu_id: string;
  title: string;
  date: string;
  meal_type: 'lunch' | 'dinner';
  consumed: boolean;
  status: 'reserved' | 'cancelled';
  createdAt?: any;
}

// ==========================================
// 2. ユーティリティ & エラーハンドリング
// ==========================================
const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// ==========================================
// 3. メインコンポーネント
// ==========================================
export default function App() {
  // --- 認証系ステート ---
  const [user, setUser] = useState<User | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // --- データ系ステート ---
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);

  // --- UI制御系ステート ---
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminTab, setAdminTab] = useState<'menu' | 'report' | 'users' | 'settings'>('menu');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  // --- トースト機能 ---
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ==========================================
  // 4. Firebase 認証ロジック
  // ==========================================
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const userDocRef = doc(db, 'users', fbUser.uid);
          const uDoc = await getDoc(userDocRef);
          
          if (uDoc.exists()) {
            setUser(uDoc.data() as User);
          } else {
            // 新規ユーザー登録 (管理者のメールアドレスは固定)
            const newUser: User = {
              id: fbUser.uid,
              name: fbUser.displayName || '職員',
              role: fbUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'student',
              createdAt: Timestamp.now()
            };
            await setDoc(userDocRef, newUser);
            setUser(newUser);
          }
        } catch (error) {
          console.error("User init error:", error);
          showToast("ユーザー情報の取得に失敗しました", "error");
        }
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // ==========================================
  // 5. リアルタイム同期ロジック (核心)
  // ==========================================
  useEffect(() => {
    if (!isAuthReady) return;

    // A. 献立データのリアルタイム同期
    const menuQuery = query(collection(db, 'menu'), orderBy('date', 'asc'));
    const unsubMenu = onSnapshot(menuQuery, (snap) => {
      const menuData = snap.docs.map(d => ({ ...d.data(), id: d.id } as MenuItem));
      setMenu(menuData);
    }, (error) => {
      console.error("Menu sync error:", error);
    });

    // B. 予約データのリアルタイム同期 (予約最優先の設計)
    // 管理者は全件、一般ユーザーは自分の予約のみ
    const resCollection = collection(db, 'reservations');
    const resQuery = user?.role === 'admin' 
      ? query(resCollection, orderBy('date', 'desc'))
      : query(resCollection, where('user_id', '==', user?.id || ''));

    const unsubRes = onSnapshot(resQuery, (snap) => {
      const resData = snap.docs.map(d => ({ ...d.data(), id: d.id } as Reservation));
      setReservations(resData);
    }, (error) => {
      console.error("Reservation sync error:", error);
    });

    // C. 管理者用ユーザーリストの同期
    let unsubUsers = () => {};
    if (user?.role === 'admin') {
      unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setAdminUsers(snap.docs.map(d => d.data() as User));
      });
    }

    return () => {
      unsubMenu();
      unsubRes();
      unsubUsers();
    };
  }, [isAuthReady, user]);

  // ==========================================
  // 6. 業務アクション (予約・喫食・管理者操作)
  // ==========================================

  // 予約のトグル (最優先アクション)
  const handleToggleReservation = async (menuItem: MenuItem) => {
    if (!user) return;
    const resId = `${user.id}_${menuItem.id}`;
    const exists = reservations.find(r => r.id === resId);

    try {
      if (exists) {
        // 予約取り消し (ピンクボタンの挙動)
        await deleteDoc(doc(db, 'reservations', resId));
        showToast("予約を取り消しました");
      } else {
        // 予約作成 (グリーンボタンの挙動)
        const newRes: Reservation = {
          id: resId,
          user_id: user.id,
          user_name: user.name,
          menu_id: menuItem.id!,
          title: menuItem.title,
          date: menuItem.date,
          meal_type: menuItem.meal_type,
          consumed: false,
          status: 'reserved',
          createdAt: Timestamp.now()
        };
        await setDoc(doc(db, 'reservations', resId), newRes);
        showToast("予約を完了しました！");
      }
    } catch (error) {
      showToast("操作に失敗しました", "error");
    }
  };

  // 喫食ステータスのトグル
  const handleToggleConsumed = async (resId: string, currentState: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), {
        consumed: !currentState
      });
      showToast(!currentState ? "喫食を確認しました" : "確認を取り消しました");
    } catch (error) {
      showToast("更新に失敗しました", "error");
    }
  };

  // CSVエクスポート
  const exportToCSV = () => {
    const headers = "日付,氏名,区分,メニュー,喫食状況\n";
    const rows = reservations.map(r => 
      `${r.date},${r.user_name},${r.meal_type === 'lunch' ? '昼食' : '夕食'},${r.title},${r.consumed ? '完了' : '未'}`
    ).join("\n");
    const blob = new Blob(["\uFEFF" + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `予約状況_${formatDate(new Date())}.csv`;
    link.click();
  };

  // ==========================================
  // 7. レンダリング (UIパーツ)
  // ==========================================
  if (!isAuthReady) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#FDFCFB]">
        <Loader2 className="animate-spin text-[#00A86B] mb-4" size={48} />
        <p className="font-black text-stone-300 tracking-widest text-xs uppercase">Connecting to Clinic System...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#2D2D2D] font-sans selection:bg-[#00A86B]/10">
      
      {/* --- ヘッダー (image_79c220.jpg 準拠) --- */}
      <header className="px-8 py-5 flex items-center justify-between bg-white border-b border-stone-50 sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="bg-[#00A86B] p-2.5 rounded-[1.2rem] text-white shadow-lg shadow-[#00A86B]/20">
            <UtensilsCrossed size={26} />
          </div>
          <div className="leading-tight">
            <h1 className="text-2xl font-black tracking-tighter">開聞クリニック</h1>
            <p className="text-[10px] font-black text-stone-300 tracking-[0.15em] uppercase">Meal Order System</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <button 
              onClick={() => setIsAdminView(!isAdminView)} 
              className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-xs font-black transition-all ${
                isAdminView ? 'bg-[#00A86B] text-white shadow-lg' : 'bg-stone-50 text-stone-500 hover:bg-stone-100'
              }`}
            >
              <Settings size={14} />
              <span>{isAdminView ? '予約画面へ戻る' : '管理者メニュー'}</span>
            </button>
          )}
          {user && (
            <div className="flex items-center gap-4 ml-2 pl-6 border-l border-stone-100">
              <div className="text-right hidden sm:block">
                <p className="text-[8px] font-black text-stone-300 uppercase leading-none mb-1">Signed in as</p>
                <p className="text-sm font-black text-stone-800">{user.name}</p>
              </div>
              <button 
                onClick={() => signOut(auth)} 
                className="p-2.5 text-stone-300 hover:text-rose-500 transition-colors bg-stone-50 rounded-xl"
              >
                <LogOut size={20} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-6 md:p-10 lg:p-14">
        {!user ? (
          /* --- ログイン画面 (image_77e8fe.png 準拠) --- */
          <div className="max-w-md mx-auto mt-20 animate-in fade-in zoom-in duration-700">
            <div className="bg-white p-14 rounded-[4rem] shadow-[0_40px_80px_-15px_rgba(0,0,0,0.08)] border border-stone-50 text-center">
              <div className="w-24 h-24 bg-[#00A86B]/5 text-[#00A86B] rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 shadow-inner">
                <UserIcon size={48} />
              </div>
              <h2 className="text-3xl font-black mb-4 tracking-tighter">職員ログイン</h2>
              <p className="text-stone-400 font-bold mb-12 leading-relaxed">
                開聞クリニックの<br/>アカウントで認証してください
              </p>
              <button 
                onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} 
                className="w-full py-6 bg-[#1A1A1A] text-white rounded-[2.2rem] font-black text-lg flex items-center justify-center gap-4 hover:bg-black hover:scale-[1.02] transition-all shadow-xl"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="G" />
                ログインして開始
              </button>
            </div>
          </div>
        ) : isAdminView ? (
          /* --- 管理者画面 (image_777104.png 等を統合) --- */
          <div className="space-y-10 animate-in slide-in-from-right-8 duration-700">
            <div className="flex flex-wrap gap-3 p-2 bg-stone-100/50 rounded-[2.5rem] w-fit">
              {[
                {id: 'menu', label: '献立管理', icon: Sparkles},
                {id: 'report', label: '予約集計', icon: ClipboardList},
                {id: 'users', label: '職員名簿', icon: UserIcon},
                {id: 'settings', label: '設定', icon: Settings}
              ].map((tab) => (
                <button 
                  key={tab.id} 
                  onClick={() => setAdminTab(tab.id as any)}
                  className={`flex items-center gap-3 px-10 py-3.5 rounded-full text-xs font-black transition-all ${
                    adminTab === tab.id ? 'bg-[#00A86B] text-white shadow-xl scale-105' : 'text-stone-400 hover:text-stone-600'
                  }`}
                >
                  <tab.icon size={16} /> {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-white p-10 md:p-14 rounded-[4rem] border border-stone-50 shadow-sm min-h-[600px]">
              {adminTab === 'menu' && (
                <div className="space-y-12">
                  <div className="flex items-center justify-between">
                    <h3 className="text-3xl font-black tracking-tight">献立の管理</h3>
                    <button className="bg-stone-900 text-white px-8 py-4 rounded-2xl font-black text-sm flex items-center gap-3 hover:bg-black transition-all">
                      <Plus size={18} /> 新規登録
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {menu.length > 0 ? menu.slice().reverse().map(m => (
                      <div key={m.id} className="p-8 bg-stone-50 rounded-[2.5rem] border border-stone-100 flex justify-between items-start group hover:bg-white hover:shadow-xl transition-all">
                        <div>
                          <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            m.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'
                          }`}>
                            {m.meal_type}
                          </span>
                          <p className="text-xs font-black text-stone-300 mt-4 mb-1">{m.date}</p>
                          <p className="text-xl font-black text-stone-800">{m.title}</p>
                        </div>
                        <button 
                          onClick={() => deleteDoc(doc(db, 'menu', m.id!))}
                          className="text-stone-200 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    )) : (
                      <div className="col-span-full py-20 text-center text-stone-300 font-black italic">献立が登録されていません</div>
                    )}
                  </div>
                </div>
              )}

              {adminTab === 'report' && (
                <div className="space-y-12">
                  <div className="flex items-center justify-between">
                    <h3 className="text-3xl font-black tracking-tight">予約・喫食集計</h3>
                    <button 
                      onClick={exportToCSV}
                      className="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-black text-sm flex items-center gap-3 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
                    >
                      <FileDown size={18} /> CSV出力
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-[2.5rem] border border-stone-100 shadow-inner">
                    <table className="w-full text-left">
                      <thead className="bg-stone-50 text-[10px] font-black text-stone-400 uppercase tracking-widest">
                        <tr>
                          <th className="px-10 py-6">日付</th>
                          <th className="px-10 py-6">職員名</th>
                          <th className="px-10 py-6">メニュー</th>
                          <th className="px-10 py-6 text-center">喫食状況</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {reservations.map(res => (
                          <tr key={res.id} className="hover:bg-stone-50/50 transition-colors">
                            <td className="px-10 py-6 font-bold text-stone-500">{res.date}</td>
                            <td className="px-10 py-6 font-black text-stone-800">{res.user_name}</td>
                            <td className="px-10 py-6 font-black text-stone-800">{res.title}</td>
                            <td className="px-10 py-6 text-center">
                              {res.consumed ? 
                                <span className="bg-emerald-100 text-emerald-600 px-4 py-1.5 rounded-full text-[10px] font-black">完了</span> : 
                                <span className="bg-stone-100 text-stone-400 px-4 py-1.5 rounded-full text-[10px] font-black">未</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* --- メイン予約画面 (2カラム: image_79c220.jpg を100%再現) --- */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 animate-in slide-in-from-bottom-8 duration-1000">
            
            {/* 左カラム: 献立予約 (最優先パネル) */}
            <div className="space-y-10">
              <section className="bg-white p-10 md:p-14 rounded-[5rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.06)] border border-stone-50 flex flex-col min-h-[700px]">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-14 gap-8">
                  <h3 className="text-4xl font-black flex items-center gap-5 tracking-tighter">
                    <div className="bg-orange-50 text-orange-600 p-4 rounded-[1.8rem] shadow-inner">
                      <Calendar size={32} />
                    </div>
                    献立予約
                  </h3>
                  <div className="flex bg-stone-100/80 p-2 rounded-[2.2rem] self-start border border-stone-200/50">
                    <button 
                      onClick={() => setSelectedMealType('lunch')} 
                      className={`px-12 py-4 rounded-[1.8rem] text-sm font-black transition-all active:scale-95 ${
                        selectedMealType === 'lunch' ? 'bg-white text-orange-600 shadow-xl scale-105' : 'text-stone-400 hover:text-stone-500'
                      }`}
                    >
                      昼食
                    </button>
                    <button 
                      onClick={() => setSelectedMealType('dinner')} 
                      className={`px-12 py-4 rounded-[1.8rem] text-sm font-black transition-all active:scale-95 ${
                        selectedMealType === 'dinner' ? 'bg-white text-indigo-600 shadow-xl scale-105' : 'text-stone-400 hover:text-stone-500'
                      }`}
                    >
                      夕食
                    </button>
                  </div>
                </div>

                <div className={`flex-1 rounded-[4.5rem] p-12 border-2 flex flex-col transition-all duration-700 ${
                  reservations.some(r => r.date === selectedDate && r.meal_type === selectedMealType) 
                  ? 'bg-[#00A86B]/5 border-[#00A86B]/10 shadow-inner' : 'bg-stone-50 border-stone-100'
                }`}>
                  <div className="relative mb-14">
                    <input 
                      type="date" 
                      value={selectedDate} 
                      onChange={(e) => setSelectedDate(e.target.value)} 
                      className="bg-white px-10 py-6 rounded-[2.5rem] font-black text-stone-800 shadow-2xl shadow-stone-200/60 border-none outline-none ring-4 ring-transparent focus:ring-[#00A86B]/10 transition-all text-xl w-full sm:w-auto" 
                    />
                  </div>
                  
                  {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                    <div className="flex-1 flex flex-col justify-between space-y-16">
                      <div className="animate-in fade-in slide-in-from-left-6">
                        <span className="text-[10px] font-black text-[#00A86B] uppercase tracking-[0.4em] mb-6 block bg-[#00A86B]/10 w-fit px-5 py-1.5 rounded-full">Menu of the day</span>
                        <p className="text-6xl font-black text-stone-800 leading-[1.1] tracking-tighter">
                          {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}
                        </p>
                      </div>
                      
                      {/* 予約・取消ボタン (配色は image_79c220.jpg に準拠) */}
                      {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? (
                        <button 
                          onClick={() => handleToggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)}
                          className="w-full py-12 rounded-[3.5rem] font-black text-4xl bg-[#FF2D55] text-white shadow-[0_25px_50px_-12px_rgba(255,45,85,0.4)] hover:bg-[#E6294D] active:scale-95 transition-all"
                        >
                          予約取消
                        </button>
                      ) : (
                        <button 
                          onClick={() => handleToggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)}
                          className="w-full py-12 rounded-[3.5rem] font-black text-4xl bg-[#00A86B] text-white shadow-[0_25px_50px_-12px_rgba(0,168,107,0.4)] hover:bg-[#008F5B] active:scale-95 transition-all"
                        >
                          予約を確定
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-20 opacity-20">
                      <UtensilsCrossed size={80} className="text-stone-300 mb-6" />
                      <p className="text-stone-400 font-black text-2xl italic">献立がありません</p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* 右カラム: 本日の喫食確認 (リアルタイムリスト) */}
            <div className="space-y-10">
              <section className="bg-white p-10 md:p-14 rounded-[5rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.06)] border border-stone-50 h-full flex flex-col">
                <div className="flex items-center justify-between mb-14">
                  <h3 className="text-4xl font-black flex items-center gap-5 tracking-tighter">
                    <div className="bg-emerald-50 text-[#00A86B] p-4 rounded-[1.8rem] shadow-inner">
                      <ClipboardList size={32} />
                    </div>
                    本日の喫食確認
                  </h3>
                  <div className="flex items-center gap-3 bg-emerald-50 px-6 py-3 rounded-full border border-emerald-100">
                    <div className="w-2.5 h-2.5 bg-[#00A86B] rounded-full animate-pulse shadow-[0_0_12px_rgba(0,168,107,0.5)]"></div>
                    <span className="text-[10px] font-black text-[#00A86B] uppercase tracking-widest">Live Sync</span>
                  </div>
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
                  {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                    <AnimatePresence mode="popLayout" initial={false}>
                      {reservations.filter(r => r.date === selectedDate).map(res => (
                        <motion.div 
                          key={res.id} 
                          layout 
                          initial={{ opacity: 0, x: 20 }} 
                          animate={{ opacity: 1, x: 0 }} 
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={`flex items-center justify-between p-10 rounded-[3.5rem] border-2 transition-all ${
                            res.consumed ? 'bg-[#00A86B]/5 border-[#00A86B]/10' : 'bg-white border-stone-50 shadow-sm'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center gap-5">
                              <span className={`w-3.5 h-3.5 rounded-full shadow-sm ${
                                res.meal_type === 'lunch' ? 'bg-orange-400' : 'bg-indigo-400'
                              }`}></span>
                              <p className="font-black text-stone-800 text-3xl tracking-tighter">{res.title}</p>
                            </div>
                            <div className="flex items-center gap-3 pl-9">
                              <p className="text-[10px] font-black text-stone-300 uppercase tracking-widest leading-none">
                                {res.meal_type} / {res.user_name}
                              </p>
                              {res.consumed && (
                                <span className="flex items-center gap-1 text-[#00A86B] text-[10px] font-black bg-[#00A86B]/10 px-2 py-0.5 rounded-md">
                                  <Check size={12}/> OK
                                </span>
                              )}
                            </div>
                          </div>
                          <button 
                            onClick={() => handleToggleConsumed(res.id, res.consumed)}
                            className={`px-12 py-6 rounded-[2.2rem] font-black text-xl transition-all shadow-lg active:scale-90 ${
                              res.consumed 
                              ? 'bg-[#00A86B] text-white shadow-[#00A86B]/20' 
                              : 'bg-white text-[#00A86B] border-2 border-[#00A86B] hover:bg-[#00A86B] hover:text-white'
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              {res.consumed ? <CheckCircle2 size={24} /> : null}
                              {res.consumed ? '完了' : '確認'}
                            </span>
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center py-32 opacity-10">
                      <FileText size={100} className="text-stone-300 mb-8" />
                      <p className="text-stone-400 font-black text-2xl tracking-tight leading-relaxed">
                        本日の予約データは<br/>まだありません
                      </p>
                    </div>
                  )}
                </div>
                
                <div className="mt-14 p-10 bg-stone-50 rounded-[3.5rem] border border-stone-100">
                  <div className="flex items-start gap-4">
                    <Info className="text-[#00A86B] shrink-0 mt-1" size={24} />
                    <div>
                      <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2">Notice</p>
                      <p className="text-sm font-bold text-stone-600 leading-relaxed italic">
                        喫食の確認は、配膳時または食後に行ってください。<br/>
                        正確な集計は食材ロスの削減に繋がります。
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* --- トースト通知 (アニメーション付き) --- */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 20 }} 
            className="fixed bottom-10 left-0 right-0 flex justify-center z-[100] pointer-events-none"
          >
            <div className={`px-10 py-6 rounded-full shadow-2xl flex items-center gap-4 pointer-events-auto ${
              toast.type === 'error' ? 'bg-rose-500 text-white' : 'bg-[#1A1A1A] text-white'
            }`}>
              {toast.type === 'error' ? <AlertCircle size={24}/> : <CheckCircle2 size={24}/>}
              <span className="font-black text-lg">{toast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #E5E5E5; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D1D1D1; }
      `}</style>
    </div>
  );
}
