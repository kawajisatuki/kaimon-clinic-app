import React, { useState, useEffect, FormEvent, useRef, ChangeEvent, Component, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile, analyzeMenuFromText, validateApiKey } from './services/geminiService';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit,
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  signInAnonymously
} from 'firebase/auth';
import { db, auth } from './firebase';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, toastFn?: (msg: string, type?: 'success' | 'error') => void) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`Firestore Error [${operationType}] at ${path}:`, errorMessage);
  
  if (toastFn) {
    if (errorMessage.includes('permission-denied')) {
      toastFn("権限がありません。管理者設定を確認してください。", "error");
    } else {
      toastFn(`エラーが発生しました: ${errorMessage.substring(0, 50)}`, "error");
    }
  }
}

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4 text-center">
          <div className="glass-card p-8">
            <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">エラーが発生しました</h1>
            <button onClick={() => window.location.reload()} className="px-6 py-2 bg-emerald-600 text-white rounded-xl">再読み込み</button>
          </div>
        </div>
      );
    }
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
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [checklistDate, setChecklistDate] = useState(formatDate(new Date()));
  const [advice, setAdvice] = useState<string>("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [reportMonth, setReportMonth] = useState(formatDate(new Date()).slice(0, 7));

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- Auth & Sync ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data() as User;
          setUser(userData);
          setIsAdminView(userData.role === 'admin');
        } else {
          const newUser: User = {
            id: firebaseUser.uid,
            username: firebaseUser.email?.split('@')[0] || firebaseUser.uid,
            name: firebaseUser.displayName || '新規ユーザー',
            role: firebaseUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'student'
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
          setUser(newUser);
          setIsAdminView(newUser.role === 'admin');
        }
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!isAuthReady) return;
    const qMenu = query(collection(db, 'menu'), orderBy('date', 'asc'));
    const unsubscribeMenu = onSnapshot(qMenu, (snapshot) => {
      setMenu(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MenuItem)));
    });

    const qRes = user?.role === 'admin' 
      ? query(collection(db, 'reservations'))
      : query(collection(db, 'reservations'), where('user_id', '==', user?.id || ''));

    const unsubscribeRes = onSnapshot(qRes, (snapshot) => {
      setReservations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });

    return () => { unsubscribeMenu(); unsubscribeRes(); };
  }, [isAuthReady, user?.id]);

  // AIアドバイスの取得
  useEffect(() => {
    const currentMenu = menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType);
    if (currentMenu) {
      setLoadingAdvice(true);
      getMenuAdvice(currentMenu.title, currentMenu.description).then(res => {
        setAdvice(res || "");
        setLoadingAdvice(false);
      });
    } else {
      setAdvice("");
    }
  }, [selectedDate, selectedMealType, menu]);

  // --- 喫食チェック（ここを1つに修正しました） ---
  const toggleConsumed = async (reservationId: string, currentStatus: boolean) => {
    if (!reservationId) return;
    try {
      await updateDoc(doc(db, 'reservations', reservationId), {
        consumed: !currentStatus
      });
      setReservations(prev => prev.map(res => 
        res.id === reservationId ? { ...res, consumed: !currentStatus } : res
      ));
      showToast(!currentStatus ? '喫食を確認しました！' : '取り消しました');
    } catch (e) { 
      handleFirestoreError(e, OperationType.UPDATE, reservationId, showToast); 
    }
  };

  const toggleReservation = async (menuId: string) => {
    if (!user) return showToast('ログインしてください', 'error');
    const resId = `${user.id}_${menuId}`;
    const exists = reservations.some(r => r.menu_id === menuId && r.user_id === user.id);
    try {
      if (exists) {
        await deleteDoc(doc(db, 'reservations', resId));
        showToast('予約をキャンセルしました');
      } else {
        const target = menu.find(m => m.id === menuId);
        await setDoc(doc(db, 'reservations', resId), {
          id: resId, user_id: user.id, menu_id: menuId, status: 'reserved', consumed: false,
          date: target?.date, title: target?.title, meal_type: target?.meal_type
        });
        showToast('予約完了しました！');
      }
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, resId, showToast); }
  };

  const handleLogout = () => signOut(auth);

  if (!isAuthReady) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-stone-50 pb-20 font-sans text-stone-900">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-xl text-white"><UtensilsCrossed size={20} /></div>
          <h1 className="font-bold text-lg text-stone-800">開聞クリニック 喫食管理</h1>
        </div>
        {user && <button onClick={handleLogout} className="p-2 text-stone-400 hover:text-red-500"><LogOut size={20} /></button>}
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {!user ? (
          <div className="glass-card p-12 text-center mt-10 shadow-xl border border-stone-200">
            <h2 className="text-2xl font-bold mb-8">職員専用ログイン</h2>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-4 bg-white border border-stone-200 rounded-2xl flex items-center justify-center gap-4 font-bold hover:bg-stone-50 shadow-sm transition-all">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-6 h-6" />
              Googleでログイン
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 左側：献立と予約 */}
            <div className="space-y-6">
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-6">
                   <h3 className="text-xl font-bold flex items-center gap-2"><CalendarIcon className="text-emerald-600" /> 献立カレンダー</h3>
                </div>
                {/* 実際のカレンダーUIが入る場所 */}
                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 mb-4">
                  <p className="text-sm font-bold text-emerald-800 mb-1">{selectedDate} の献立</p>
                  <div className="flex gap-2 mb-4">
                    <button onClick={() => setSelectedMealType('lunch')} className={`flex-1 py-2 rounded-xl text-sm font-bold ${selectedMealType === 'lunch' ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-600'}`}>昼食</button>
                    <button onClick={() => setSelectedMealType('dinner')} className={`flex-1 py-2 rounded-xl text-sm font-bold ${selectedMealType === 'dinner' ? 'bg-emerald-600 text-white' : 'bg-white text-emerald-600'}`}>夕食</button>
                  </div>
                  {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                    <div className="space-y-3">
                      <p className="text-lg font-bold">{menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}</p>
                      <button onClick={() => toggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!.id)} className={`w-full py-3 rounded-2xl font-bold shadow-md transition-all ${isReserved(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!.id) ? 'bg-rose-500 text-white' : 'bg-emerald-600 text-white'}`}>
                        {isReserved(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!.id) ? '予約をキャンセル' : 'この献立を予約する'}
                      </button>
                    </div>
                  ) : <p className="text-stone-400 text-center py-4">献立が登録されていません</p>}
                </div>
              </div>

              {/* AI栄養アドバイス */}
              <div className="glass-card p-6 border-l-4 border-amber-400">
                <h3 className="font-bold flex items-center gap-2 mb-3"><Sparkles size={18} className="text-amber-500" /> AI栄養ワンポイント</h3>
                {loadingAdvice ? <div className="animate-pulse flex space-y-2 flex-col"><div className="h-4 bg-stone-200 rounded w-3/4"></div><div className="h-4 bg-stone-200 rounded w-full"></div></div> : <p className="text-sm leading-relaxed text-stone-700">{advice || "献立を選択するとアドバイスが表示されます。"}</p>}
              </div>
            </div>

            {/* 右側：喫食チェック */}
            <div className="space-y-6">
              <div className="glass-card p-6 shadow-lg border-t-4 border-emerald-500">
                <h3 className="text-xl font-bold flex items-center gap-2 mb-4"><ClipboardList className="text-emerald-600" /> 本日の喫食確認</h3>
                <input type="date" value={checklistDate} onChange={(e) => setChecklistDate(e.target.value)} className="w-full mb-4 p-3 bg-stone-100 rounded-xl border-none font-bold" />
                <div className="space-y-3">
                  {reservations.filter(r => r.date === checklistDate).length > 0 ? (
                    reservations.filter(r => r.date === checklistDate).map(res => (
                      <div key={res.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-stone-100 shadow-sm">
                        <div className="flex items-center gap-3">
                           <div className={`p-2 rounded-lg ${res.consumed ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-400'}`}><Check size={20} /></div>
                           <div>
                             <div className="font-bold">{res.title}</div>
                             <div className="text-xs text-stone-400">{res.meal_type === 'lunch' ? '昼食' : '夕食'}</div>
                           </div>
                        </div>
                        <button onClick={() => toggleConsumed(res.id, res.consumed)} className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${res.consumed ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-emerald-50'}`}>
                          {res.consumed ? '食事済' : 'チェック'}
                        </button>
                      </div>
                    ))
                  ) : <p className="text-center text-stone-400 py-8">本日の予約はありません</p>}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }} className={`fixed bottom-6 left-4 right-4 p-4 rounded-2xl shadow-xl z-50 flex items-center gap-3 ${toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-stone-800 text-white'}`}>
            {toast.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
            <span className="font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  function isReserved(menuId: string) {
    return reservations.some(r => r.menu_id === menuId && r.user_id === user?.id);
  }
}
