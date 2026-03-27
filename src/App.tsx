import React, { useState, useEffect, FormEvent, useRef, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, LogOut, UtensilsCrossed, Loader2, AlertCircle, CheckCircle2, Sparkles, Check } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice } from './services/geminiService';
import { 
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where 
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{children: ReactNode}, {hasError: boolean}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <div className="p-10 text-center"><h1>システムエラーが発生しました。再読み込みしてください。</h1></div>;
    return this.props.children;
  }
}

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [advice, setAdvice] = useState<string>("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 認証とデータ同期
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const userData = userDoc.exists() ? userDoc.data() as User : {
          id: firebaseUser.uid,
          username: firebaseUser.email?.split('@')[0] || '',
          name: firebaseUser.displayName || 'ユーザー',
          role: firebaseUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'staff'
        };
        if (!userDoc.exists()) await setDoc(doc(db, 'users', firebaseUser.uid), userData);
        setUser(userData);
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;
    const qMenu = query(collection(db, 'menu'), orderBy('date', 'asc'));
    const unsubscribeMenu = onSnapshot(qMenu, (snap) => setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem))));
    
    // 全ユーザーの予約を監視（喫食確認用）
    const qRes = query(collection(db, 'reservations'));
    const unsubscribeRes = onSnapshot(qRes, (snap) => setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation))));
    
    return () => { unsubscribeMenu(); unsubscribeRes(); };
  }, [user]);

  // AIアドバイス取得
  useEffect(() => {
    const currentMenu = menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType);
    if (currentMenu) {
      setLoadingAdvice(true);
      getMenuAdvice(currentMenu.title, currentMenu.description).then(res => {
        setAdvice(res || "栄養バランスの良い食事を心がけましょう。");
        setLoadingAdvice(false);
      });
    } else {
      setAdvice("本日も美味しく食べて、元気に過ごしましょう！");
    }
  }, [selectedDate, selectedMealType, menu]);

  // 喫食ステータス更新 (GitHub Actionsエラーを回避した単一関数)
  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), { consumed: !currentStatus });
      showToast(!currentStatus ? '食事済に更新しました' : '未完了に戻しました');
    } catch (e) {
      showToast('更新に失敗しました', 'error');
    }
  };

  // 予約の切り替え
  const toggleReservation = async (menuItem: MenuItem) => {
    if (!user) return;
    const resId = `${user.id}_${menuItem.id}`;
    const exists = reservations.find(r => r.id === resId);
    try {
      if (exists) {
        await deleteDoc(doc(db, 'reservations', resId));
        showToast('予約をキャンセルしました');
      } else {
        await setDoc(doc(db, 'reservations', resId), {
          id: resId, user_id: user.id, menu_id: menuItem.id,
          title: menuItem.title, date: menuItem.date, meal_type: menuItem.meal_type,
          consumed: false, status: 'reserved'
        });
        showToast('予約を完了しました！');
      }
    } catch (e) {
      showToast('エラーが発生しました', 'error');
    }
  };

  if (!isAuthReady) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 pb-10">
      <header className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-lg text-white"><UtensilsCrossed size={20} /></div>
          <h1 className="font-bold text-xl tracking-tight">開聞クリニック 喫食管理</h1>
        </div>
        {user && <button onClick={() => signOut(auth)} className="text-stone-400 hover:text-red-500 transition-colors"><LogOut size={22} /></button>}
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-8">
        {!user ? (
          <div className="max-w-md mx-auto mt-20 glass-card p-10 text-center shadow-2xl border border-stone-200 rounded-3xl">
            <h2 className="text-2xl font-bold mb-8 text-stone-800">職員専用ログイン</h2>
            <button 
              onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
              className="w-full py-4 bg-white border-2 border-stone-100 rounded-2xl flex items-center justify-center gap-4 font-bold hover:bg-stone-50 transition-all shadow-sm"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-6 h-6" />
              Googleアカウントでログイン
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 左カラム: カレンダー & AI */}
            <div className="space-y-6">
              <section className="glass-card p-6 rounded-3xl shadow-sm border border-stone-100">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-6 text-stone-800">
                  <CalendarIcon className="text-emerald-600" size={20} /> 献立カレンダー
                </h3>
                
                <div className="bg-emerald-50/50 rounded-2xl p-5 border border-emerald-100">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-emerald-800 font-bold">{selectedDate} の献立</span>
                    <div className="flex bg-white rounded-xl p-1 shadow-sm border border-emerald-100">
                      <button onClick={() => setSelectedMealType('lunch')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedMealType === 'lunch' ? 'bg-emerald-600 text-white' : 'text-emerald-600'}`}>昼食</button>
                      <button onClick={() => setSelectedMealType('dinner')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedMealType === 'dinner' ? 'bg-emerald-600 text-white' : 'text-emerald-600'}`}>夕食</button>
                    </div>
                  </div>

                  {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                    <div className="space-y-4">
                      <p className="text-xl font-extrabold text-stone-800">{menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}</p>
                      <button 
                        onClick={() => toggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)}
                        className={`w-full py-3.5 rounded-xl font-bold transition-all shadow-md ${reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id && r.user_id === user.id) ? 'bg-rose-500 text-white hover:bg-rose-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                      >
                        {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id && r.user_id === user.id) ? 'この献立の予約を消す' : 'この献立を予約する'}
                      </button>
                    </div>
                  ) : <p className="text-stone-400 text-center py-6">献立データがありません</p>}
                </div>
              </section>

              <section className="glass-card p-6 rounded-3xl border border-stone-100 bg-gradient-to-br from-white to-amber-50/30">
                <h3 className="font-bold flex items-center gap-2 mb-3 text-stone-800">
                  <Sparkles size={18} className="text-amber-500" /> AI栄養ワンポイント
                </h3>
                {loadingAdvice ? (
                  <div className="animate-pulse space-y-2"><div className="h-3 bg-stone-200 rounded w-full"></div><div className="h-3 bg-stone-200 rounded w-5/6"></div></div>
                ) : (
                  <p className="text-sm leading-relaxed text-stone-600 font-medium">{advice}</p>
                )}
              </section>
            </div>

            {/* 右カラム: 喫食確認 */}
            <section className="glass-card p-6 rounded-3xl shadow-sm border border-stone-100">
              <h3 className="text-lg font-bold flex items-center gap-2 mb-6 text-stone-800">
                <ClipboardList className="text-emerald-600" size={20} /> 本日の喫食確認
              </h3>
              
              <div className="mb-6">
                <input 
                  type="date" 
                  value={selectedDate} 
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full p-4 bg-stone-100 border-none rounded-2xl font-bold text-stone-700 focus:ring-2 focus:ring-emerald-500 transition-all cursor-pointer"
                />
              </div>

              <div className="space-y-3">
                {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                  reservations.filter(r => r.date === selectedDate).map(res => (
                    <div key={res.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-stone-100 shadow-sm hover:border-emerald-200 transition-all">
                      <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-xl ${res.consumed ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-300'}`}>
                          <Check size={20} strokeWidth={3} />
                        </div>
                        <div>
                          <div className="font-bold text-stone-800">{res.title}</div>
                          <div className="text-xs font-bold text-stone-400 uppercase tracking-wider">{res.meal_type === 'lunch' ? '昼食' : '夕食'}</div>
                        </div>
                      </div>
                      <button 
                        onClick={() => toggleConsumed(res.id, res.consumed)}
                        className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${res.consumed ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}
                      >
                        {res.consumed ? '食事済' : '未完了'}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-16">
                    <div className="inline-block p-4 bg-stone-50 rounded-full mb-4 text-stone-300"><CalendarIcon size={32} /></div>
                    <p className="text-stone-400 font-medium">この日の予約はありません</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, scale: 0.9 }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.9 }} 
            className={`fixed bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-80 p-5 rounded-2xl shadow-2xl z-[60] flex items-center gap-4 border border-white/20 backdrop-blur-lg ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-stone-800 text-white'}`}
          >
            {toast.type === 'error' ? <AlertCircle size={22} /> : <CheckCircle2 size={22} className="text-emerald-400" />}
            <span className="font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
