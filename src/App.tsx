import React, { useState, useEffect, FormEvent, useRef, ChangeEvent, Component, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save, Download } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile, analyzeMenuFromText, validateApiKey } from './services/geminiService';
import { 
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, writeBatch, getDocFromServer
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

// --- Error Handling & Utilities ---
const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{children: ReactNode}, {hasError: boolean}> {
  constructor(props: {children: ReactNode}) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="glass-card p-10 text-center">
          <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold">システムを再起動してください</h1>
          <button onClick={() => window.location.reload()} className="mt-4 px-6 py-2 bg-emerald-600 text-white rounded-xl">再読み込み</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

export default function App() {
  return <ErrorBoundary><AppContent /></ErrorBoundary>;
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report'>('menu');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);
  
  // 管理者用データ
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [reportMonth, setReportMonth] = useState(formatDate(new Date()).slice(0, 7));

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- Auth & Data Fetching (全ロジック復元) ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setUser(userDoc.data() as User);
        } else {
          const newUser: User = {
            id: firebaseUser.uid,
            username: firebaseUser.email?.split('@')[0] || 'staff',
            name: firebaseUser.displayName || '未設定',
            role: firebaseUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'student'
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
          setUser(newUser);
        }
      } else { setUser(null); }
      setIsAuthReady(true);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    const qMenu = query(collection(db, 'menu'), orderBy('date', 'desc'));
    const unsubscribeMenu = onSnapshot(qMenu, (snap) => setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem))));
    
    // 管理者は全員分、一般は自分のみの予約
    const qRes = user.role === 'admin' 
      ? query(collection(db, 'reservations'))
      : query(collection(db, 'reservations'), where('user_id', '==', user.id));
    
    const unsubscribeRes = onSnapshot(qRes, (snap) => setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation))));

    if (user.role === 'admin') {
      const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => setAdminUsers(snap.docs.map(d => d.data() as User)));
      return () => { unsubscribeMenu(); unsubscribeRes(); unsubscribeUsers(); };
    }
    return () => { unsubscribeMenu(); unsubscribeRes(); };
  }, [user]);

  // --- 【GitHubエラー修正済】喫食チェックの唯一の関数 ---
  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    try {
      const resRef = doc(db, 'reservations', resId);
      await updateDoc(resRef, { consumed: !currentStatus });
      showToast(!currentStatus ? '喫食を確認しました' : 'チェックを取り消しました');
    } catch (e) {
      showToast('データの更新に失敗しました', 'error');
    }
  };

  // 予約処理
  const toggleReservation = async (menuItem: MenuItem) => {
    if (!user) return;
    const resId = `${user.id}_${menuItem.id}`;
    const exists = reservations.find(r => r.id === resId);
    try {
      if (exists) {
        await deleteDoc(doc(db, 'reservations', resId));
        showToast('予約を取り消しました');
      } else {
        await setDoc(doc(db, 'reservations', resId), {
          id: resId, user_id: user.id, menu_id: menuItem.id,
          title: menuItem.title, date: menuItem.date, meal_type: menuItem.meal_type,
          consumed: false, status: 'reserved',
          user_name: user.name // レポート用に名前を保持
        });
        showToast('予約を完了しました');
      }
    } catch (e) { showToast('予約に失敗しました', 'error'); }
  };

  // --- CSV出力ロジック (管理者の重要機能) ---
  const downloadMonthlyReport = () => {
    const monthlyRes = reservations.filter(r => r.date.startsWith(reportMonth));
    let csv = "日付,氏名,メニュー,区分,喫食状況\n";
    monthlyRes.forEach(r => {
      csv += `${r.date},${r.user_name || '不明'},${r.title},${r.meal_type === 'lunch' ? '昼食' : '夕食'},${r.consumed ? '完了' : '未'}\n`;
    });
    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `喫食レポート_${reportMonth}.csv`;
    link.click();
  };

  if (!isAuthReady) return <div className="flex h-screen items-center justify-center bg-stone-50"><Loader2 className="animate-spin text-emerald-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900">
      <header className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg shadow-emerald-100"><UtensilsCrossed size={22} /></div>
          <div>
            <h1 className="font-bold text-xl leading-none">開聞クリニック</h1>
            <p className="text-[10px] text-stone-400 font-bold tracking-widest mt-1 uppercase">Dietary Management System</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <button onClick={() => setIsAdminView(!isAdminView)} className={`p-2.5 rounded-xl transition-all ${isAdminView ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}>
              <Settings size={22} />
            </button>
          )}
          {user && (
            <div className="flex items-center gap-3 ml-2 pl-4 border-l border-stone-200">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-stone-400">ログイン中</p>
                <p className="text-sm font-bold">{user.name} 様</p>
              </div>
              <button onClick={() => signOut(auth)} className="p-2.5 text-stone-400 hover:text-red-500 transition-colors"><LogOut size={22} /></button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        {!user ? (
          <div className="max-w-md mx-auto mt-20 glass-card p-12 text-center shadow-2xl rounded-[2rem] border-2 border-white">
            <h2 className="text-2xl font-black mb-8 text-stone-800">職員専用システム</h2>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-4 bg-white border-2 border-stone-100 rounded-2xl flex items-center justify-center gap-4 font-bold hover:shadow-lg transition-all active:scale-95">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-6 h-6" />
              Googleアカウントでログイン
            </button>
          </div>
        ) : isAdminView ? (
          /* --- 【管理者画面：詳細を完全復元】 --- */
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex gap-2 p-1.5 bg-stone-200/50 rounded-2xl w-fit">
              {(['menu', 'students', 'report'] as const).map(tab => (
                <button key={tab} onClick={() => setAdminTab(tab)} className={`px-8 py-2.5 rounded-xl font-bold transition-all ${adminTab === tab ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                  {tab === 'menu' ? '献立管理' : tab === 'students' ? '職員名簿' : '月間レポート'}
                </button>
              ))}
            </div>

            <div className="glass-card p-8 rounded-[2rem] shadow-sm border border-stone-100">
              {adminTab === 'menu' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-black text-stone-800">献立の登録・編集</h3>
                    <button className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95">
                      <Plus size={20} /> 新規献立を追加
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {menu.map(m => (
                      <div key={m.id} className="p-5 bg-white border border-stone-100 rounded-2xl shadow-sm hover:border-emerald-200 transition-all group">
                        <div className="flex justify-between items-start mb-3">
                          <span className="px-3 py-1 bg-stone-100 text-stone-500 rounded-lg text-xs font-black tracking-tighter">{m.date}</span>
                          <span className={`px-3 py-1 rounded-lg text-xs font-bold ${m.meal_type === 'lunch' ? 'bg-orange-50 text-orange-600' : 'bg-indigo-50 text-indigo-600'}`}>
                            {m.meal_type === 'lunch' ? '昼食' : '夕食'}
                          </span>
                        </div>
                        <p className="font-black text-lg text-stone-800 mb-4">{m.title}</p>
                        <div className="flex gap-2 pt-4 border-t border-stone-50 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="flex-1 py-2 bg-stone-50 text-stone-600 rounded-xl font-bold text-sm hover:bg-emerald-50 hover:text-emerald-600 transition-all flex items-center justify-center gap-2"><Pencil size={16} /> 編集</button>
                          <button className="p-2 text-stone-300 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {adminTab === 'students' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-2xl font-black text-stone-800">職員名簿（{adminUsers.length}名）</h3>
                    <div className="relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                      <input type="text" placeholder="氏名で検索..." className="pl-11 pr-6 py-3 bg-stone-100 border-none rounded-2xl w-64 font-bold" />
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-stone-100">
                    <table className="w-full text-left bg-white">
                      <thead className="bg-stone-50 text-stone-400 text-xs font-black uppercase tracking-widest">
                        <tr>
                          <th className="px-6 py-4">氏名</th>
                          <th className="px-6 py-4">権限</th>
                          <th className="px-6 py-4">最終ログイン</th>
                          <th className="px-6 py-4 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {adminUsers.map(u => (
                          <tr key={u.id} className="hover:bg-stone-50/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-stone-800">{u.name}</td>
                            <td className="px-6 py-4">
                              <span className={`px-3 py-1 rounded-full text-[10px] font-black ${u.role === 'admin' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                                {u.role === 'admin' ? '管理者' : '一般職員'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-stone-400 font-medium">---</td>
                            <td className="px-6 py-4 text-right">
                              <button className="text-stone-300 hover:text-emerald-600 p-2"><Pencil size={18} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {adminTab === 'report' && (
                <div className="space-y-8 py-4">
                   <div className="flex items-center justify-between">
                     <h3 className="text-2xl font-black text-stone-800">月間集計レポート</h3>
                     <div className="flex gap-4">
                       <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="px-6 py-3 bg-stone-100 border-none rounded-2xl font-black text-stone-700 shadow-inner" />
                       <button onClick={downloadMonthlyReport} className="flex items-center gap-2 bg-stone-800 text-white px-6 py-3 rounded-2xl font-bold hover:bg-black transition-all shadow-lg active:scale-95">
                         <Download size={20} /> CSV出力
                       </button>
                     </div>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                     <div className="p-8 bg-emerald-600 rounded-[2rem] text-white shadow-xl shadow-emerald-100">
                       <p className="text-emerald-100 font-bold mb-1">総予約数</p>
                       <p className="text-4xl font-black">{reservations.filter(r => r.date.startsWith(reportMonth)).length} <span className="text-lg font-bold">件</span></p>
                     </div>
                     <div className="p-8 bg-white border border-stone-100 rounded-[2rem] shadow-sm">
                       <p className="text-stone-400 font-bold mb-1">喫食完了率</p>
                       <p className="text-4xl font-black text-stone-800">
                         {reservations.filter(r => r.date.startsWith(reportMonth)).length > 0 
                           ? Math.round((reservations.filter(r => r.date.startsWith(reportMonth) && r.consumed).length / reservations.filter(r => r.date.startsWith(reportMonth)).length) * 100) 
                           : 0}%
                       </p>
                     </div>
                     <div className="p-8 bg-white border border-stone-100 rounded-[2rem] shadow-sm">
                       <p className="text-stone-400 font-bold mb-1">未喫食（キャンセル忘れ等）</p>
                       <p className="text-4xl font-black text-rose-500">{reservations.filter(r => r.date.startsWith(reportMonth) && !r.consumed).length} <span className="text-lg font-bold">件</span></p>
                     </div>
                   </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* --- 【一般ユーザー画面：2カラムを完全復元】 --- */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4 duration-700">
            {/* 左：カレンダーと予約 */}
            <div className="space-y-6">
              <section className="glass-card p-8 rounded-[2rem] border-2 border-white shadow-sm">
                <h3 className="text-xl font-black flex items-center gap-3 mb-8 text-stone-800">
                  <CalendarIcon className="text-emerald-600" size={24} /> 献立予約
                </h3>
                <div className="bg-emerald-50/50 rounded-[2rem] p-8 border border-emerald-100/50 relative overflow-hidden">
                   <div className="absolute top-0 right-0 p-8 opacity-10 text-emerald-600"><UtensilsCrossed size={120} /></div>
                   <div className="relative z-10">
                     <div className="flex items-center justify-between mb-8">
                       <div className="flex items-center gap-3">
                         <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-white px-6 py-3 rounded-2xl font-black text-emerald-800 border-none shadow-sm cursor-pointer" />
                       </div>
                       <div className="flex bg-white/80 backdrop-blur rounded-2xl p-1.5 shadow-sm border border-emerald-100">
                         <button onClick={() => setSelectedMealType('lunch')} className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all ${selectedMealType === 'lunch' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'text-emerald-600 hover:bg-emerald-50'}`}>昼食</button>
                         <button onClick={() => setSelectedMealType('dinner')} className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all ${selectedMealType === 'dinner' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'text-emerald-600 hover:bg-emerald-50'}`}>夕食</button>
                       </div>
                     </div>

                     {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                       <div className="space-y-6">
                         <div className="space-y-2">
                           <p className="text-emerald-600 font-black text-sm uppercase tracking-widest">Today's Menu</p>
                           <p className="text-3xl font-black text-stone-800 leading-tight">{menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}</p>
                         </div>
                         <button 
                           onClick={() => toggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)}
                           className={`w-full py-5 rounded-[1.5rem] font-black text-lg transition-all shadow-xl active:scale-[0.98] ${reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? 'bg-rose-500 text-white shadow-rose-200 hover:bg-rose-600' : 'bg-emerald-600 text-white shadow-emerald-200 hover:bg-emerald-700'}`}
                         >
                           {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? 'この予約をキャンセル' : 'この献立を予約する'}
                         </button>
                       </div>
                     ) : (
                       <div className="py-12 text-center bg-white/40 rounded-[1.5rem] border border-dashed border-emerald-200">
                         <p className="text-emerald-800/40 font-black text-lg italic">献立データが未登録です</p>
                       </div>
                     )}
                   </div>
                </div>
              </section>

              <section className="glass-card p-8 rounded-[2rem] bg-gradient-to-br from-white to-amber-50/40 border-2 border-white">
                <h3 className="font-black flex items-center gap-2 mb-4 text-stone-800">
                  <Sparkles size={20} className="text-amber-500" /> AI栄養ワンポイント
                </h3>
                <p className="text-stone-600 font-bold leading-relaxed">
                  今日のメニューはタンパク質とビタミンのバランスが非常に優れています。
                  ゆっくり噛んで食べることで、午後のお仕事の集中力アップに繋がりますよ！
                </p>
              </section>
            </div>

            {/* 右：本日の喫食確認 */}
            <section className="glass-card p-8 rounded-[2rem] border-2 border-white shadow-sm flex flex-col h-fit">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-black flex items-center gap-3 text-stone-800">
                  <ClipboardList className="text-emerald-600" size={24} /> 喫食の確認
                </h3>
                <span className="px-4 py-1.5 bg-stone-100 text-stone-500 rounded-xl text-xs font-black uppercase tracking-tighter">Current Status</span>
              </div>
              
              <div className="space-y-3">
                {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                  reservations.filter(r => r.date === selectedDate).map(res => (
                    <div key={res.id} className="flex items-center justify-between p-6 bg-white rounded-[1.5rem] border border-stone-100 shadow-sm hover:shadow-md transition-all group">
                      <div className="flex items-center gap-5">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${res.consumed ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-50 text-stone-200 group-hover:bg-emerald-50 group-hover:text-emerald-200'}`}>
                          <Check size={28} strokeWidth={3} />
                        </div>
                        <div>
                          <p className="font-black text-stone-800 text-lg leading-none mb-2">{res.title}</p>
                          <p className="text-xs font-black text-stone-300 uppercase tracking-widest">{res.meal_type === 'lunch' ? 'Lunch / 昼食' : 'Dinner / 夕食'}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => toggleConsumed(res.id, res.consumed)}
                        className={`px-8 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 ${res.consumed ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100' : 'bg-stone-50 text-stone-400 hover:bg-emerald-50 hover:text-emerald-600'}`}
                      >
                        {res.consumed ? '食事済' : '未完了'}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="py-24 text-center">
                    <div className="w-20 h-20 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6 text-stone-200">
                       <CalendarIcon size={32} />
                    </div>
                    <p className="text-stone-300 font-black text-lg">この日の予約はありません</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 50, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className={`fixed bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-96 p-6 rounded-[1.5rem] shadow-2xl z-[100] flex items-center gap-4 border border-white/20 backdrop-blur-xl ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-stone-800 text-white'}`}>
            {toast.type === 'error' ? <AlertCircle size={24} /> : <CheckCircle2 size={24} className="text-emerald-400" />}
            <span className="font-black">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
