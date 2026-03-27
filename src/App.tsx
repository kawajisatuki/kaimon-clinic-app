import React, { useState, useEffect, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, LogOut, UtensilsCrossed, Loader2, Pencil, Trash2, AlertCircle, Check, Plus, Settings, Sparkles, Download, CheckCircle2 } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice } from './services/geminiService';
import { 
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where 
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

// --- Utilities ---
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
    if (this.state.hasError) return <div className="p-10 text-center font-bold">システムエラーが発生しました。再読み込みしてください。</div>;
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
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [reportMonth, setReportMonth] = useState(formatDate(new Date()).slice(0, 7));

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- ログインロジックの修正 ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        let userData: User;
        if (userDoc.exists()) {
          userData = userDoc.data() as User;
        } else {
          // 新規職員の自動登録（ここを管理者限定にせず、全員通すようにしました）
          userData = {
            id: firebaseUser.uid,
            username: firebaseUser.email?.split('@')[0] || 'staff',
            name: firebaseUser.displayName || '未設定職員',
            role: firebaseUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'student'
          };
          await setDoc(userDocRef, userData);
        }
        setUser(userData);
      } else {
        setUser(null);
        setIsAdminView(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribeAuth();
  }, []);

  // --- データ購読（全職員・全献立） ---
  useEffect(() => {
    if (!user) return;
    
    // 献立の取得
    const unsubscribeMenu = onSnapshot(query(collection(db, 'menu'), orderBy('date', 'desc')), (snap) => {
      setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem)));
    });

    // 予約の取得（管理者は全表示、職員は自分の分）
    const qRes = user.role === 'admin' 
      ? query(collection(db, 'reservations'))
      : query(collection(db, 'reservations'), where('user_id', '==', user.id));
    
    const unsubscribeRes = onSnapshot(qRes, (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation)));
    });

    if (user.role === 'admin') {
      const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setAdminUsers(snap.docs.map(d => d.data() as User));
      });
      return () => { unsubscribeMenu(); unsubscribeRes(); unsubscribeUsers(); };
    }
    return () => { unsubscribeMenu(); unsubscribeRes(); };
  }, [user]);

  // --- 【GitHubエラー対応】関数の重複を完全に排除 ---
  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), { consumed: !currentStatus });
      showToast(!currentStatus ? '喫食を確認しました' : 'チェックを取り消しました');
    } catch (e) {
      showToast('更新に失敗しました', 'error');
    }
  };

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
          consumed: false, status: 'reserved', user_name: user.name
        });
        showToast('予約を完了しました');
      }
    } catch (e) { showToast('予約に失敗しました', 'error'); }
  };

  if (!isAuthReady) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-emerald-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      <header className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg shadow-emerald-100"><UtensilsCrossed size={22} /></div>
          <h1 className="font-bold text-xl">開聞クリニック 喫食管理</h1>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <button onClick={() => setIsAdminView(!isAdminView)} className={`p-2.5 rounded-xl transition-all ${isAdminView ? 'bg-emerald-600 text-white shadow-lg' : 'bg-stone-100 text-stone-600'}`}>
              <Settings size={22} />
            </button>
          )}
          {user && <button onClick={() => signOut(auth)} className="p-2.5 text-stone-400 hover:text-red-500 transition-colors"><LogOut size={22} /></button>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        {!user ? (
          <div className="max-w-md mx-auto mt-20 bg-white p-12 text-center shadow-2xl rounded-[2rem] border border-stone-100">
            <h2 className="text-2xl font-black mb-8">職員専用システム</h2>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-4 bg-white border-2 border-stone-100 rounded-2xl flex items-center justify-center gap-4 font-bold hover:bg-stone-50 transition-all active:scale-95">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-6 h-6" />
              Googleでログイン
            </button>
          </div>
        ) : isAdminView ? (
          /* 管理者画面 */
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex gap-2 p-1 bg-stone-200/50 rounded-2xl w-fit">
              {(['menu', 'students', 'report'] as const).map(tab => (
                <button key={tab} onClick={() => setAdminTab(tab)} className={`px-8 py-2.5 rounded-xl font-bold transition-all ${adminTab === tab ? 'bg-white text-emerald-700 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                  {tab === 'menu' ? '献立管理' : tab === 'students' ? '職員名簿' : '月間レポート'}
                </button>
              ))}
            </div>
            <div className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100 min-h-[400px]">
              {adminTab === 'menu' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-black">献立登録一覧</h3>
                    <button className="flex items-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95"><Plus size={20} /> 新規登録</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {menu.map(m => (
                      <div key={m.id} className="p-4 border border-stone-100 rounded-2xl flex justify-between items-center hover:border-emerald-200 transition-all">
                        <div><p className="text-xs font-bold text-stone-400">{m.date}</p><p className="font-bold">{m.title}</p></div>
                        <div className="flex gap-1 text-stone-300"><button className="p-2 hover:text-emerald-600"><Pencil size={18} /></button><button className="p-2 hover:text-red-500"><Trash2 size={18} /></button></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {adminTab === 'students' && (
                <div className="space-y-6">
                  <h3 className="text-xl font-black">職員名簿（{adminUsers.length}名）</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {adminUsers.map(u => (
                      <div key={u.id} className="p-4 bg-stone-50 rounded-2xl flex justify-between items-center font-bold">
                        <span>{u.name}</span>
                        <span className="text-xs bg-white px-3 py-1 rounded-lg shadow-sm">{u.role === 'admin' ? '管理者' : '一般職員'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {adminTab === 'report' && (
                <div className="space-y-6 text-center py-20">
                  <h3 className="text-xl font-black">月間レポート出力</h3>
                  <div className="flex justify-center gap-4">
                    <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="px-6 py-3 bg-stone-100 rounded-2xl font-bold border-none" />
                    <button className="bg-stone-800 text-white px-8 py-3 rounded-2xl font-bold flex items-center gap-2 shadow-lg hover:bg-black transition-all active:scale-95"><Download size={20} /> CSV出力</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 一般職員画面：2カラム復活 */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-4 duration-700">
            {/* 左：献立カレンダー */}
            <div className="space-y-6">
              <section className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100">
                <h3 className="text-xl font-black flex items-center gap-3 mb-8 text-stone-800"><CalendarIcon className="text-emerald-600" size={24} /> 献立カレンダー</h3>
                <div className="bg-emerald-50 rounded-[2rem] p-8 border border-emerald-100/50">
                   <div className="flex items-center justify-between mb-8">
                     <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-white px-6 py-3 rounded-2xl font-black text-emerald-800 shadow-sm border-none cursor-pointer" />
                     <div className="flex bg-white/80 rounded-2xl p-1 shadow-sm">
                       <button onClick={() => setSelectedMealType('lunch')} className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${selectedMealType === 'lunch' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-600'}`}>昼食</button>
                       <button onClick={() => setSelectedMealType('dinner')} className={`px-4 py-2 rounded-xl text-sm font-black transition-all ${selectedMealType === 'dinner' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-600'}`}>夕食</button>
                     </div>
                   </div>
                   {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                     <div className="space-y-6 text-center">
                       <p className="text-3xl font-black text-stone-800">{menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}</p>
                       <button onClick={() => toggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)} className={`w-full py-5 rounded-[1.5rem] font-black text-lg transition-all shadow-xl active:scale-95 ${reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? 'bg-rose-500 text-white shadow-rose-200' : 'bg-emerald-600 text-white shadow-emerald-200'}`}>
                         {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? 'この予約をキャンセル' : 'この献立を予約する'}
                       </button>
                     </div>
                   ) : <div className="py-12 text-center text-stone-400 font-bold italic">献立が登録されていません</div>}
                </div>
              </section>
              <section className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100">
                <h3 className="font-black flex items-center gap-2 mb-2 text-stone-800"><Sparkles size={20} className="text-amber-500" /> AI栄養ワンポイント</h3>
                <p className="text-stone-500 font-bold">今日も美味しく食べて、元気に過ごしましょう！</p>
              </section>
            </div>

            {/* 右：喫食確認 */}
            <section className="bg-white p-8 rounded-[2rem] shadow-sm border border-stone-100 h-fit">
              <h3 className="text-xl font-black flex items-center gap-3 mb-8 text-stone-800"><ClipboardList className="text-emerald-600" size={24} /> 本日の喫食確認</h3>
              <div className="space-y-4">
                {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                  reservations.filter(r => r.date === selectedDate).map(res => (
                    <div key={res.id} className="flex items-center justify-between p-6 bg-stone-50 rounded-[1.5rem] border border-stone-100 hover:shadow-md transition-all group">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${res.consumed ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-stone-200 shadow-sm'}`}><Check size={28} strokeWidth={3} /></div>
                        <div><p className="font-black text-stone-800 text-lg">{res.title}</p><p className="text-xs font-bold text-stone-300 uppercase">{res.meal_type === 'lunch' ? '昼食' : '夕食'}</p></div>
                      </div>
                      <button onClick={() => toggleConsumed(res.id, res.consumed)} className={`px-8 py-3 rounded-2xl font-black text-sm transition-all ${res.consumed ? 'bg-emerald-600 text-white shadow-lg' : 'bg-white text-emerald-600 shadow-sm hover:bg-emerald-50'}`}>
                        {res.consumed ? '食事済' : '未完了'}
                      </button>
                    </div>
                  ))
                ) : <div className="py-24 text-center text-stone-300 font-black">本日の予約はありません</div>}
              </div>
            </section>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} className={`fixed bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-96 p-6 rounded-[1.5rem] shadow-2xl z-[100] flex items-center gap-4 border border-white/20 backdrop-blur-xl ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-stone-800 text-white'}`}>
            {toast.type === 'error' ? <AlertCircle size={24} /> : <CheckCircle2 size={24} className="text-emerald-400" />}
            <span className="font-black">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
