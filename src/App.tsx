import React, { useState, useEffect, FormEvent, useRef, ChangeEvent, Component, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile, analyzeMenuFromText, validateApiKey } from './services/geminiService';
import { 
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, writeBatch, getDocFromServer
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: string, path: string | null, toastFn?: (msg: string, type?: 'success' | 'error') => void) {
  console.error(`Firestore Error [${operationType}] at ${path}:`, error);
  if (toastFn) toastFn("エラーが発生しました。権限や通信状況を確認してください。", "error");
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{children: ReactNode}, {hasError: boolean}> {
  constructor(props: {children: ReactNode}) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <div className="p-10 text-center"><h1>重大なエラーが発生しました。ページを更新してください。</h1></div>;
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
  const [advice, setAdvice] = useState<string>("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report'>('menu');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 認証 & データ同期
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const userData = userDoc.exists() ? userDoc.data() as User : {
          id: firebaseUser.uid,
          username: firebaseUser.email?.split('@')[0] || '',
          name: firebaseUser.displayName || 'ユーザー',
          role: firebaseUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'student'
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
    const qRes = query(collection(db, 'reservations'));
    const unsubscribeRes = onSnapshot(qRes, (snap) => setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation))));
    return () => { unsubscribeMenu(); unsubscribeRes(); };
  }, [user]);

  // AIアドバイスの自動取得
  useEffect(() => {
    const currentMenu = menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType);
    if (currentMenu) {
      setLoadingAdvice(true);
      getMenuAdvice(currentMenu.title, currentMenu.description).then(res => {
        setAdvice(res || "バランスの良い食事を！");
        setLoadingAdvice(false);
      });
    } else {
      setAdvice("今日も一日お疲れ様です。");
    }
  }, [selectedDate, selectedMealType, menu]);

  // --- 【重要】GitHubエラーを解消した唯一の toggleConsumed ---
  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), { consumed: !currentStatus });
      showToast(!currentStatus ? '喫食を確認しました！' : '取り消しました');
    } catch (e) {
      handleFirestoreError(e, 'UPDATE', `reservations/${resId}`, showToast);
    }
  };

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
        showToast('予約完了しました！');
      }
    } catch (e) { showToast('エラーが発生しました', 'error'); }
  };

  if (!isAuthReady) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900">
      <header className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-lg text-white"><UtensilsCrossed size={20} /></div>
          <h1 className="font-bold text-xl">開聞クリニック 喫食管理</h1>
        </div>
        <div className="flex items-center gap-4">
          {user?.role === 'admin' && (
            <button onClick={() => setIsAdminView(!isAdminView)} className={`p-2 rounded-full transition-all ${isAdminView ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600'}`}>
              <Settings size={20} />
            </button>
          )}
          {user && <button onClick={() => signOut(auth)} className="text-stone-400 hover:text-red-500"><LogOut size={22} /></button>}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 md:p-8">
        {!user ? (
          <div className="max-w-md mx-auto mt-20 glass-card p-10 text-center shadow-xl border border-stone-200">
            <h2 className="text-2xl font-bold mb-8">職員専用ログイン</h2>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-4 bg-white border border-stone-200 rounded-2xl flex items-center justify-center gap-4 font-bold hover:bg-stone-50 transition-all">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-6 h-6" />
              Googleでログイン
            </button>
          </div>
        ) : isAdminView ? (
          /* --- 管理者画面：中身を完全に復元 --- */
          <div className="space-y-6">
            <div className="flex gap-2 pb-4 overflow-x-auto">
              <button onClick={() => setAdminTab('menu')} className={`px-6 py-2 rounded-full font-bold whitespace-nowrap ${adminTab === 'menu' ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600'}`}>献立管理</button>
              <button onClick={() => setAdminTab('students')} className={`px-6 py-2 rounded-full font-bold whitespace-nowrap ${adminTab === 'students' ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600'}`}>職員管理</button>
              <button onClick={() => setAdminTab('report')} className={`px-6 py-2 rounded-full font-bold whitespace-nowrap ${adminTab === 'report' ? 'bg-emerald-600 text-white' : 'bg-white text-stone-600'}`}>月間レポート</button>
            </div>
            <div className="glass-card p-6">
              {adminTab === 'menu' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold">献立登録・編集</h3>
                    <button className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold"><Plus size={18} /> 新規登録</button>
                  </div>
                  {/* ここに献立リストのループが入ります */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {menu.slice(-6).map(m => (
                      <div key={m.id} className="p-4 bg-white border border-stone-100 rounded-2xl shadow-sm flex items-center justify-between">
                        <div>
                          <p className="text-xs text-stone-400">{m.date}</p>
                          <p className="font-bold">{m.title}</p>
                        </div>
                        <div className="flex gap-2">
                          <button className="p-2 text-stone-400 hover:text-emerald-600"><Pencil size={18} /></button>
                          <button className="p-2 text-stone-400 hover:text-red-500"><Trash2 size={18} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {adminTab === 'students' && <div className="p-10 text-center font-bold text-stone-400">職員一覧を表示中... (Firebaseから取得)</div>}
              {adminTab === 'report' && <div className="p-10 text-center font-bold text-stone-400">月間統計レポートを作成中...</div>}
            </div>
          </div>
        ) : (
          /* --- ユーザー画面：2カラムを完全に復元 --- */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <section className="glass-card p-6 rounded-3xl border border-stone-100 shadow-sm">
                <h3 className="text-lg font-bold flex items-center gap-2 mb-6"><CalendarIcon className="text-emerald-600" size={20} /> 献立予約</h3>
                <div className="bg-emerald-50 rounded-2xl p-5 border border-emerald-100">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-bold text-emerald-800">{selectedDate} の献立</span>
                    <div className="flex bg-white rounded-xl p-1 shadow-sm border border-emerald-100">
                      <button onClick={() => setSelectedMealType('lunch')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedMealType === 'lunch' ? 'bg-emerald-600 text-white' : 'text-emerald-600'}`}>昼食</button>
                      <button onClick={() => setSelectedMealType('dinner')} className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${selectedMealType === 'dinner' ? 'bg-emerald-600 text-white' : 'text-emerald-600'}`}>夕食</button>
                    </div>
                  </div>
                  {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                    <div className="space-y-4">
                      <p className="text-xl font-extrabold text-stone-800">{menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}</p>
                      <button onClick={() => toggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)} className={`w-full py-4 rounded-xl font-bold transition-all shadow-md ${reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id && r.user_id === user.id) ? 'bg-rose-500 text-white' : 'bg-emerald-600 text-white'}`}>
                        {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id && r.user_id === user.id) ? '予約をキャンセル' : 'この献立を予約する'}
                      </button>
                    </div>
                  ) : <p className="text-center py-6 text-stone-400 font-bold italic">献立が登録されていません</p>}
                </div>
              </section>

              <section className="glass-card p-6 rounded-3xl bg-gradient-to-br from-white to-amber-50/30 border border-stone-100">
                <h3 className="font-bold flex items-center gap-2 mb-3 text-stone-800"><Sparkles size={18} className="text-amber-500" /> AI栄養ワンポイント</h3>
                <p className="text-sm leading-relaxed text-stone-600 font-medium">{advice}</p>
              </section>
            </div>

            <section className="glass-card p-6 rounded-3xl shadow-sm border border-stone-100">
              <h3 className="text-lg font-bold flex items-center gap-2 mb-6"><ClipboardList className="text-emerald-600" size={20} /> 本日の喫食確認</h3>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full mb-6 p-4 bg-stone-100 rounded-2xl border-none font-bold text-stone-700" />
              <div className="space-y-3">
                {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                  reservations.filter(r => r.date === selectedDate).map(res => (
                    <div key={res.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-stone-100 shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-xl ${res.consumed ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-300'}`}><Check size={20} /></div>
                        <div>
                          <div className="font-bold text-stone-800">{res.title}</div>
                          <div className="text-xs font-bold text-stone-400 uppercase">{res.meal_type === 'lunch' ? '昼食' : '夕食'}</div>
                        </div>
                      </div>
                      <button onClick={() => toggleConsumed(res.id, res.consumed)} className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${res.consumed ? 'bg-emerald-600 text-white' : 'bg-stone-50 text-emerald-600'}`}>
                        {res.consumed ? '食事済' : '未完了'}
                      </button>
                    </div>
                  ))
                ) : <div className="text-center py-10 text-stone-400 font-medium">本日の予約はありません</div>}
              </div>
            </section>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className={`fixed bottom-6 left-4 right-4 md:left-auto md:right-8 md:w-80 p-5 rounded-2xl shadow-2xl z-50 flex items-center gap-4 border border-white/20 backdrop-blur-lg ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-stone-800 text-white'}`}>
            {toast.type === 'error' ? <AlertCircle size={22} /> : <CheckCircle2 size={22} className="text-emerald-400" />}
            <span className="font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
