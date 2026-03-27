import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, ClipboardList, UtensilsCrossed, LogOut, 
  Settings, CheckCircle2, Check, Trash2, User as UserIcon,
  ChevronRight, AlertCircle, Info, Loader2, Plus, FileDown, 
  Search, ShieldCheck, Clock, UserPlus, Filter, Download,
  MoreVertical, Edit3, Save, X, ChevronLeft, CalendarDays,
  Users, BarChart3, Database, HardDrive, RefreshCcw
} from 'lucide-react';
import { 
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, 
  onSnapshot, query, where, orderBy, Timestamp, getDocs, 
  writeBatch, limit, startAfter, serverTimestamp 
} from 'firebase/firestore';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, 
  signOut, setPersistence, browserLocalPersistence 
} from 'firebase/auth';
import { db, auth } from './firebase';

// ==========================================
// 1. 高度な型定義 (Core Domain Schema)
// ==========================================
interface UserProfile {
  id: string;
  name: string;
  role: 'admin' | 'student';
  email: string;
  lastLogin?: any;
  department?: string;
}

interface MenuItem {
  id?: string;
  date: string;
  title: string;
  meal_type: 'lunch' | 'dinner';
  description?: string;
  calories?: string;
  createdBy?: string;
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
  timestamp: any;
}

// ==========================================
// 2. ユーティリティ (Business Logic Helpers)
// ==========================================
const getTodayStr = () => new Date().toISOString().split('T')[0];

const MEAL_TYPES = {
  LUNCH: 'lunch' as const,
  DINNER: 'dinner' as const
};

// ==========================================
// 3. メインアプリケーションコンポーネント
// ==========================================
export default function App() {
  // --- 認証系ステート ---
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);

  // --- データ系ステート ---
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [staffList, setStaffList] = useState<UserProfile[]>([]);
  
  // --- UI・操作系ステート ---
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());
  const [activeMealType, setActiveMealType] = useState<'lunch' | 'dinner'>(MEAL_TYPES.LUNCH);
  const [adminActiveTab, setAdminActiveTab] = useState<'menu' | 'analytics' | 'staff'>('menu');
  const [isLoading, setIsLoading] = useState(false);
  const [globalToast, setGlobalToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // --- 管理者用編集ステート ---
  const [newMenuTitle, setNewMenuTitle] = useState('');
  const [isAddingMenu, setIsAddingMenu] = useState(false);

  // ==========================================
  // 4. Firebase Authentication ロジック
  // ==========================================
  useEffect(() => {
    // 永続性の設定
    setPersistence(auth, browserLocalPersistence);

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const userRef = doc(db, 'users', fbUser.uid);
          const userSnap = await getDoc(userRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.data() as UserProfile;
            setUser(userData);
            // ログイン時刻の更新
            await updateDoc(userRef, { lastLogin: serverTimestamp() });
          } else {
            // 初回ログイン時の自動登録 (管理者メールアドレス判定)
            const isFirstAdmin = fbUser.email === 'satukikawaji@gmail.com';
            const newUser: UserProfile = {
              id: fbUser.uid,
              name: fbUser.displayName || '未設定職員',
              role: isFirstAdmin ? 'admin' : 'student',
              email: fbUser.email || '',
              department: '一般'
            };
            await setDoc(userRef, { ...newUser, lastLogin: serverTimestamp() });
            setUser(newUser);
          }
        } catch (error) {
          console.error("Auth Error:", error);
          triggerToast("ログイン処理中にエラーが発生しました", "error");
        }
      } else {
        setUser(null);
        setIsAdminMode(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // ==========================================
  // 5. リアルタイム・データ同期 (Real-time Sync)
  // ==========================================
  useEffect(() => {
    if (!isAuthReady || !user) return;

    // A. 献立データの同期 (前後1ヶ月分を対象)
    const menuQuery = query(
      collection(db, 'menu'),
      orderBy('date', 'desc'),
      limit(100)
    );
    const unsubMenu = onSnapshot(menuQuery, (snapshot) => {
      const items = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as MenuItem));
      setMenuItems(items);
    });

    // B. 予約データの同期 (管理者は全件、一般は自分のみ)
    const resBaseQuery = collection(db, 'reservations');
    const resQuery = user.role === 'admin' 
      ? query(resBaseQuery, orderBy('date', 'desc'), limit(500))
      : query(resBaseQuery, where('user_id', '==', user.id));

    const unsubRes = onSnapshot(resQuery, (snapshot) => {
      const resData = snapshot.docs.map(d => ({ ...d.data(), id: d.id } as Reservation));
      setReservations(resData);
    });

    // C. 職員名簿の同期 (管理者のみ)
    let unsubStaff = () => {};
    if (user.role === 'admin') {
      unsubStaff = onSnapshot(collection(db, 'users'), (snapshot) => {
        setStaffList(snapshot.docs.map(d => d.data() as UserProfile));
      });
    }

    return () => {
      unsubMenu();
      unsubRes();
      unsubStaff();
    };
  }, [isAuthReady, user]);

  // ==========================================
  // 6. 業務アクション (Core Actions)
  // ==========================================

  const triggerToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setGlobalToast({ msg, type });
    setTimeout(() => setGlobalToast(null), 4000);
  };

  // 予約実行・取消ロジック
  const toggleReservation = async (targetMenu: MenuItem) => {
    if (!user) return;
    const reservationId = `${user.id}_${targetMenu.id}`;
    const isReserved = reservations.some(r => r.id === reservationId);

    setIsLoading(true);
    try {
      if (isReserved) {
        await deleteDoc(doc(db, 'reservations', reservationId));
        triggerToast("予約を取り消しました");
      } else {
        const newDoc: Reservation = {
          id: reservationId,
          user_id: user.id,
          user_name: user.name,
          menu_id: targetMenu.id!,
          title: targetMenu.title,
          date: targetMenu.date,
          meal_type: targetMenu.meal_type,
          consumed: false,
          timestamp: serverTimestamp()
        };
        await setDoc(doc(db, 'reservations', reservationId), newDoc);
        triggerToast("予約が完了しました！");
      }
    } catch (err) {
      triggerToast("通信に失敗しました。電波状況を確認してください", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // 喫食確認ロジック
  const toggleConsumedStatus = async (res: Reservation) => {
    try {
      const resRef = doc(db, 'reservations', res.id);
      await updateDoc(resRef, { consumed: !res.consumed });
    } catch (err) {
      triggerToast("更新できませんでした", "error");
    }
  };

  // 献立追加 (管理者)
  const handleAddMenu = async () => {
    if (!newMenuTitle) return;
    try {
      await setDoc(doc(collection(db, 'menu')), {
        date: selectedDate,
        title: newMenuTitle,
        meal_type: activeMealType,
        createdBy: user?.name
      });
      setNewMenuTitle('');
      setIsAddingMenu(false);
      triggerToast("献立を登録しました");
    } catch (e) {
      triggerToast("登録エラー", "error");
    }
  };

  // CSVレポート生成
  const exportToCSV = () => {
    const BOM = "\uFEFF";
    const header = "日付,区分,職員名,メニュー,喫食ステータス\n";
    const rows = reservations.map(r => 
      `${r.date},${r.meal_type === 'lunch' ? '昼食' : '夕食'},${r.user_name},${r.title},${r.consumed ? '完了' : '未'}`
    ).join("\n");
    
    const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `開聞クリニック_予約台帳_${getTodayStr()}.csv`;
    link.click();
  };

  // ==========================================
  // 7. フィルタリング & 計算ロジック
  // ==========================================
  const currentMenu = useMemo(() => {
    return menuItems.find(m => m.date === selectedDate && m.meal_type === activeMealType);
  }, [menuItems, selectedDate, activeMealType]);

  const todaysReservations = useMemo(() => {
    return reservations.filter(r => r.date === selectedDate)
      .sort((a, b) => a.meal_type === 'lunch' ? -1 : 1);
  }, [reservations, selectedDate]);

  // ==========================================
  // 8. レンダリングコンポーネント
  // ==========================================
  if (!isAuthReady) return (
    <div className="h-screen bg-[#FDFCFB] flex flex-col items-center justify-center">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
        <RefreshCcw className="text-[#00A86B]" size={48} />
      </motion.div>
      <p className="mt-6 font-black text-stone-300 tracking-[0.3em] uppercase text-xs">Connecting Database...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#2D2D2D] font-sans selection:bg-[#00A86B]/10 selection:text-[#00A86B]">
      
      {/* 共通ヘッダー (image_79c220.jpg 準拠) */}
      <header className="px-10 py-7 flex items-center justify-between bg-white/80 backdrop-blur-xl border-b border-stone-100 sticky top-0 z-[100]">
        <div className="flex items-center gap-6">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="bg-[#00A86B] p-3 rounded-[1.4rem] text-white shadow-2xl shadow-emerald-200"
          >
            <UtensilsCrossed size={30} />
          </motion.div>
          <div className="leading-none">
            <h1 className="text-3xl font-black tracking-tighter">開聞クリニック</h1>
            <p className="text-[10px] font-black text-stone-300 tracking-[0.25em] uppercase mt-2">Staff Meal Reservation</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {user?.role === 'admin' && (
            <button 
              onClick={() => setIsAdminMode(!isAdminMode)}
              className={`flex items-center gap-3 px-8 py-3.5 rounded-full text-xs font-black transition-all ${
                isAdminMode ? 'bg-[#00A86B] text-white shadow-xl shadow-emerald-100' : 'bg-stone-50 text-stone-400 hover:bg-stone-100'
              }`}
            >
              {isAdminMode ? <Users size={16}/> : <Settings size={16}/>}
              <span>{isAdminMode ? '現場画面へ戻る' : '管理者メニュー'}</span>
            </button>
          )}
          {user && (
            <div className="flex items-center gap-5 ml-4 pl-8 border-l border-stone-100">
              <div className="text-right hidden md:block">
                <p className="text-[9px] font-black text-stone-300 uppercase mb-1">Authenticated</p>
                <p className="text-sm font-black text-stone-800">{user.name}</p>
              </div>
              <button 
                onClick={() => signOut(auth)}
                className="p-3.5 text-stone-300 hover:text-rose-500 transition-all bg-stone-50 rounded-2xl hover:bg-rose-50"
              >
                <LogOut size={22} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-8 md:p-14 lg:p-20">
        {!user ? (
          /* ログイン画面 (image_77e8fe.png 準拠) */
          <div className="max-w-xl mx-auto mt-10">
            <motion.div 
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white p-20 rounded-[5rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.08)] border border-stone-50 text-center relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-400 to-[#00A86B]"></div>
              <div className="w-28 h-28 bg-emerald-50 text-[#00A86B] rounded-[3rem] flex items-center justify-center mx-auto mb-12 shadow-inner">
                <UserIcon size={56} />
              </div>
              <h2 className="text-4xl font-black mb-6 tracking-tight">職員専用ログイン</h2>
              <p className="text-stone-400 font-bold mb-16 text-lg leading-relaxed">
                開聞クリニックの<br/>職員アカウントを使用して<br/>システムにアクセスしてください
              </p>
              <button 
                onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
                className="w-full py-8 bg-[#1A1A1A] text-white rounded-[2.8rem] font-black text-xl flex items-center justify-center gap-5 hover:bg-black hover:scale-[1.02] transition-all shadow-2xl active:scale-95"
              >
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-7 h-7" alt="G" />
                Googleでログイン
              </button>
              <p className="mt-12 text-[10px] font-black text-stone-200 uppercase tracking-widest">Authorized Staff Only</p>
            </motion.div>
          </div>
        ) : isAdminMode ? (
          /* 管理者ダッシュボード (image_777104.png 等を統合・強化) */
          <div className="space-y-12 animate-in fade-in duration-700">
            <div className="flex flex-wrap items-center justify-between gap-8">
              <div className="flex gap-3 p-2 bg-stone-100/80 rounded-[2.8rem] border border-stone-200/50">
                {[
                  { id: 'menu', label: '献立管理', icon: CalendarDays },
                  { id: 'analytics', label: '集計レポート', icon: BarChart3 },
                  { id: 'staff', label: '職員名簿', icon: Users }
                ].map((tab) => (
                  <button 
                    key={tab.id}
                    onClick={() => setAdminActiveTab(tab.id as any)}
                    className={`flex items-center gap-3 px-10 py-4 rounded-full text-xs font-black transition-all ${
                      adminActiveTab === tab.id ? 'bg-[#00A86B] text-white shadow-xl scale-105' : 'text-stone-400 hover:text-stone-600'
                    }`}
                  >
                    <tab.icon size={16} />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
              
              <div className="flex gap-4">
                <button onClick={exportToCSV} className="bg-emerald-600 text-white px-8 py-4 rounded-[1.5rem] font-black text-sm flex items-center gap-3 hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all">
                  <Download size={18} /> CSV保存
                </button>
                <button onClick={() => setIsAddingMenu(true)} className="bg-stone-900 text-white px-8 py-4 rounded-[1.5rem] font-black text-sm flex items-center gap-3 hover:bg-black shadow-xl transition-all">
                  <Plus size={18} /> 新規献立
                </button>
              </div>
            </div>

            <div className="bg-white p-16 rounded-[5rem] border border-stone-50 shadow-sm min-h-[700px]">
              {adminActiveTab === 'menu' && (
                <div className="space-y-12">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {menuItems.map(m => (
                      <div key={m.id} className="group p-10 bg-stone-50 rounded-[3.5rem] border border-stone-100 hover:bg-white hover:shadow-2xl hover:border-transparent transition-all relative overflow-hidden">
                        <div className={`absolute top-0 right-0 px-6 py-2 rounded-bl-[1.5rem] text-[9px] font-black uppercase tracking-widest ${
                          m.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'
                        }`}>
                          {m.meal_type}
                        </div>
                        <p className="text-[10px] font-black text-[#00A86B] mb-3">{m.date}</p>
                        <h4 className="text-2xl font-black text-stone-800 tracking-tighter mb-6">{m.title}</h4>
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-black text-stone-300 italic">Added by {m.createdBy || 'System'}</span>
                          <button onClick={() => deleteDoc(doc(db, 'menu', m.id!))} className="text-stone-200 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all">
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {adminActiveTab === 'analytics' && (
                <div className="space-y-12">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                    <div className="p-10 bg-emerald-50 rounded-[3rem] border border-emerald-100">
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2">Total Reservations</p>
                      <p className="text-5xl font-black text-emerald-700">{reservations.length}</p>
                    </div>
                    <div className="p-10 bg-orange-50 rounded-[3rem] border border-orange-100">
                      <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-2">Consumption Rate</p>
                      <p className="text-5xl font-black text-orange-700">
                        {reservations.length > 0 ? Math.round((reservations.filter(r => r.consumed).length / reservations.length) * 100) : 0}%
                      </p>
                    </div>
                  </div>
                  <div className="rounded-[3rem] border border-stone-100 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-stone-50 text-[10px] font-black text-stone-400 uppercase tracking-[0.2em]">
                        <tr>
                          <th className="px-10 py-7">日付</th>
                          <th className="px-10 py-7">職員</th>
                          <th className="px-10 py-7">メニュー</th>
                          <th className="px-10 py-7 text-center">状態</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {reservations.slice(0, 50).map(r => (
                          <tr key={r.id} className="hover:bg-stone-50/50 transition-all">
                            <td className="px-10 py-6 text-xs font-bold text-stone-400">{r.date}</td>
                            <td className="px-10 py-6 font-black text-stone-800">{r.user_name}</td>
                            <td className="px-10 py-6 font-black text-stone-600">{r.title}</td>
                            <td className="px-10 py-6 text-center">
                              {r.consumed ? 
                                <span className="bg-emerald-100 text-emerald-600 px-4 py-1.5 rounded-full text-[9px] font-black">喫食済</span> :
                                <span className="bg-stone-100 text-stone-300 px-4 py-1.5 rounded-full text-[9px] font-black">未喫食</span>
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
          /* 現場画面 (image_79c220.jpg 100%再現・省略なし) */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start animate-in slide-in-from-bottom-12 duration-1000">
            
            {/* 左：献立予約セクション */}
            <div className="space-y-12">
              <section className="bg-white p-12 md:p-16 rounded-[5.5rem] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.07)] border border-stone-50 flex flex-col min-h-[850px] relative overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-20 gap-10">
                  <h3 className="text-5xl font-black flex items-center gap-6 tracking-tighter">
                    <div className="text-orange-600 bg-orange-50 p-5 rounded-[2.2rem] shadow-inner">
                      <Calendar size={40}/>
                    </div>
                    献立予約
                  </h3>
                  <div className="flex bg-stone-100/80 p-3 rounded-[2.5rem] border border-stone-200/50 self-start shadow-inner">
                    {[MEAL_TYPES.LUNCH, MEAL_TYPES.DINNER].map((type) => (
                      <button 
                        key={type} 
                        onClick={() => setActiveMealType(type)}
                        className={`px-16 py-5 rounded-[2rem] text-sm font-black transition-all active:scale-95 ${
                          activeMealType === type ? 'bg-white text-orange-600 shadow-2xl scale-105' : 'text-stone-400 hover:text-stone-500'
                        }`}
                      >
                        {type === 'lunch' ? '昼食' : '夕食'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={`flex-1 rounded-[5rem] p-16 border-2 flex flex-col transition-all duration-700 ${
                  reservations.some(r => r.date === selectedDate && r.meal_type === activeMealType) 
                  ? 'bg-[#00A86B]/5 border-[#00A86B]/20 shadow-inner' : 'bg-stone-50/50 border-stone-100'
                }`}>
                  <div className="mb-20">
                    <input 
                      type="date" 
                      value={selectedDate} 
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="bg-white px-12 py-7 rounded-[3rem] font-black text-stone-800 shadow-2xl shadow-stone-200/50 border-none outline-none ring-[12px] ring-transparent focus:ring-[#00A86B]/5 transition-all text-3xl w-full sm:w-auto text-center" 
                    />
                  </div>
                  
                  {currentMenu ? (
                    <div className="flex-1 flex flex-col justify-between space-y-24">
                      <motion.div 
                        key={currentMenu.id}
                        initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
                        className="duration-700"
                      >
                        <span className="text-[11px] font-black text-[#00A86B] uppercase tracking-[0.5em] mb-10 block bg-[#00A86B]/10 w-fit px-8 py-2.5 rounded-full shadow-sm">Today's Selected Menu</span>
                        <p className="text-8xl font-black text-stone-800 leading-[0.95] tracking-tighter">
                          {currentMenu.title}
                        </p>
                        {currentMenu.calories && (
                          <p className="mt-8 text-stone-400 font-bold flex items-center gap-3">
                            <Info size={18}/> 概算熱量: {currentMenu.calories} kcal
                          </p>
                        )}
                      </motion.div>
                      
                      {/* メインアクションボタン：あのピンクとグリーンの究極の再現 */}
                      <AnimatePresence mode="wait">
                        {reservations.some(r => r.menu_id === currentMenu.id) ? (
                          <motion.button 
                            key="cancel"
                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }}
                            onClick={() => toggleReservation(currentMenu)}
                            disabled={isLoading}
                            className="w-full py-14 rounded-[4rem] font-black text-6xl bg-[#FF2D55] text-white shadow-[0_40px_80px_-20px_rgba(255,45,85,0.45)] hover:bg-[#E6294D] active:scale-95 transition-all flex items-center justify-center gap-6"
                          >
                            {isLoading ? <Loader2 className="animate-spin" size={48}/> : '予約取消'}
                          </motion.button>
                        ) : (
                          <motion.button 
                            key="confirm"
                            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }}
                            onClick={() => toggleReservation(currentMenu)}
                            disabled={isLoading}
                            className="w-full py-14 rounded-[4rem] font-black text-6xl bg-[#00A86B] text-white shadow-[0_40px_80px_-20px_rgba(0,168,107,0.45)] hover:bg-[#008F5B] active:scale-95 transition-all flex items-center justify-center gap-6"
                          >
                            {isLoading ? <Loader2 className="animate-spin" size={48}/> : '予約を確定'}
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-32 opacity-10">
                      <Database size={150} className="text-stone-300 mb-12" />
                      <p className="text-stone-400 font-black text-4xl tracking-tight leading-relaxed italic">
                        指定された日付の献立データが<br/>見つかりません
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* 右：本日の喫食確認セクション */}
            <div className="space-y-12">
              <section className="bg-white p-12 md:p-16 rounded-[5.5rem] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.07)] border border-stone-50 h-full min-h-[850px] flex flex-col">
                <div className="flex items-center justify-between mb-20">
                  <h3 className="text-5xl font-black flex items-center gap-6 tracking-tighter">
                    <div className="text-[#00A86B] bg-emerald-50 p-5 rounded-[2.2rem] shadow-inner">
                      <ClipboardList size={40}/>
                    </div>
                    本日の喫食確認
                  </h3>
                  <div className="flex items-center gap-4 bg-emerald-50 px-8 py-4 rounded-full border border-emerald-100 shadow-sm">
                    <div className="w-4 h-4 bg-[#00A86B] rounded-full animate-pulse shadow-[0_0_20px_rgba(0,168,107,0.6)]"></div>
                    <span className="text-xs font-black text-[#00A86B] uppercase tracking-[0.2em] leading-none">Cloud Sync</span>
                  </div>
                </div>

                <div className="flex-1 space-y-8 overflow-y-auto pr-4 custom-scrollbar">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {todaysReservations.length > 0 ? (
                      todaysReservations.map(res => (
                        <motion.div 
                          key={res.id} 
                          layout 
                          initial={{ opacity: 0, y: 30 }} 
                          animate={{ opacity: 1, y: 0 }} 
                          exit={{ opacity: 0, scale: 0.9 }}
                          className={`flex items-center justify-between p-14 rounded-[4.5rem] border-2 transition-all group ${
                            res.consumed ? 'bg-[#00A86B]/5 border-[#00A86B]/20 shadow-inner' : 'bg-white border-stone-50 shadow-xl shadow-stone-100/40'
                          }`}
                        >
                          <div className="space-y-4">
                            <div className="flex items-center gap-8">
                              <span className={`w-5 h-5 rounded-full shadow-inner ${
                                res.meal_type === 'lunch' ? 'bg-orange-400' : 'bg-indigo-400'
                              }`}></span>
                              <p className="font-black text-stone-800 text-5xl tracking-tighter leading-none">{res.title}</p>
                            </div>
                            <div className="flex items-center gap-6 pl-14">
                              <p className="text-xs font-black text-stone-300 uppercase tracking-[0.3em] leading-none">
                                {res.meal_type} / {res.user_name}
                              </p>
                              {res.consumed && (
                                <motion.span 
                                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                                  className="flex items-center gap-2 text-[#00A86B] text-[11px] font-black bg-[#00A86B]/15 px-4 py-1.5 rounded-xl border border-[#00A86B]/10"
                                >
                                  <Check size={16} strokeWidth={4}/> 完了
                                </motion.span>
                              )}
                            </div>
                          </div>
                          
                          {/* 確認完了ボタン：グリーンと白の切り替えデザイン */}
                          <button 
                            onClick={() => toggleConsumedStatus(res)}
                            className={`px-16 py-8 rounded-[3rem] font-black text-3xl transition-all shadow-[0_20px_40px_-10px_rgba(0,0,0,0.1)] active:scale-90 ${
                              res.consumed 
                              ? 'bg-[#00A86B] text-white shadow-emerald-200' 
                              : 'bg-white text-[#00A86B] border-[4px] border-[#00A86B] hover:bg-[#00A86B] hover:text-white'
                            }`}
                          >
                            <span className="flex items-center gap-5">
                              {res.consumed ? <CheckCircle2 size={32} /> : null}
                              {res.consumed ? '完了' : '確認'}
                            </span>
                          </button>
                        </motion.div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center py-48 opacity-15">
                        <HardDrive size={180} className="text-stone-300 mb-12" />
                        <p className="text-stone-400 font-black text-4xl tracking-tight leading-relaxed">
                          本日の予約は<br/>登録されていません
                        </p>
                      </div>
                    )}
                  </AnimatePresence>
                </div>
                
                {/* 現場職員への通知パネル */}
                <div className="mt-20 p-14 bg-stone-50/80 rounded-[4.5rem] border border-stone-100 shadow-inner flex items-start gap-8">
                  <div className="bg-white p-5 rounded-[1.8rem] shadow-xl text-[#00A86B]">
                    <ShieldCheck size={36} />
                  </div>
                  <div>
                    <p className="text-[12px] font-black text-stone-400 uppercase tracking-[0.4em] mb-4">Quality & Safety</p>
                    <p className="text-lg font-bold text-stone-600 leading-relaxed italic">
                      喫食確認は、必ず配膳時に行い、データの正確性を維持してください。<br/>
                      システムに関する不明点は教育委員会まで。
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* グローバルトースト (全画面通知) */}
      <AnimatePresence>
        {globalToast && (
          <motion.div 
            initial={{ opacity: 0, y: 80, scale: 0.9 }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.8, y: 40 }} 
            className="fixed bottom-16 left-0 right-0 flex justify-center z-[1000] pointer-events-none"
          >
            <div className={`px-16 py-8 rounded-[3.5rem] shadow-[0_40px_100px_-15px_rgba(0,0,0,0.4)] flex items-center gap-6 pointer-events-auto border-4 ${
              globalToast.type === 'error' ? 'bg-rose-500 border-rose-400 text-white' : 'bg-[#1A1A1A] border-stone-800 text-white'
            }`}>
              {globalToast.type === 'error' ? <AlertCircle size={36}/> : <CheckCircle2 size={36} className="text-[#00A86B]"/>}
              <span className="font-black text-2xl tracking-tight">{globalToast.msg}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* スタイル調整 */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #EDEDED; border-radius: 30px; border: 2px solid white; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D8D8D8; }
        input[type="date"]::-webkit-calendar-picker-indicator {
          cursor: pointer;
          filter: invert(0.5);
        }
      `}</style>
    </div>
  );
}
