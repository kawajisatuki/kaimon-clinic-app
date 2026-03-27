import React, { useState, useEffect, FormEvent, useRef, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile, analyzeMenuFromText } from './services/geminiService';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit,
  writeBatch
} from 'firebase/firestore';
import { 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  signInWithPopup
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

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Safe localStorage helper
const safeStorage = {
  getItem: (key: string) => { try { return localStorage.getItem(key); } catch { return null; } },
  setItem: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} },
  removeItem: (key: string) => { try { localStorage.removeItem(key); } catch {} }
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginError, setLoginError] = useState("");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [checklistDate, setChecklistDate] = useState(formatDate(new Date()));

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- Auth & Data Sync ---
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

  // --- Core Functions ---
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

  // --- 喫食チェック機能（ここを修正しました） ---
  const toggleConsumed = async (reservationId: string, currentStatus: boolean) => {
    if (!reservationId) return;
    try {
      await updateDoc(doc(db, 'reservations', reservationId), {
        consumed: !currentStatus
      });
      // 画面上の表示を即座に更新
      setReservations(prev => prev.map(res => 
        res.id === reservationId ? { ...res, consumed: !currentStatus } : res
      ));
      showToast(!currentStatus ? '喫食を確認しました！' : '取り消しました');
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, reservationId, showToast); }
  };

  const handleLogout = () => signOut(auth).then(() => setUser(null));

  if (!isAuthReady) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-stone-50 pb-20 font-sans text-stone-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-emerald-600 p-2 rounded-xl text-white"><UtensilsCrossed size={20} /></div>
          <h1 className="font-bold text-lg tracking-tight text-stone-800">開聞クリニック 喫食管理</h1>
        </div>
        {user && (
          <button onClick={handleLogout} className="p-2 text-stone-400 hover:text-red-500 transition-colors"><LogOut size={20} /></button>
        )}
      </header>

      <main className="max-w-2xl mx-auto p-4">
        {!user ? (
          <div className="glass-card p-8 text-center mt-10">
             <h2 className="text-xl font-bold mb-6">ログイン</h2>
             <button 
               onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
               className="w-full py-4 bg-white border border-stone-200 rounded-2xl flex items-center justify-center gap-3 font-medium hover:bg-stone-50 transition-all shadow-sm"
             >
               Googleでサインイン
             </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* カレンダー表示等のUIがここに入ります */}
            <div className="glass-card p-4">
              <h3 className="font-bold mb-4 flex items-center gap-2">
                <ClipboardList className="text-emerald-600" size={20} />
                本日の予約確認
              </h3>
              {reservations.filter(r => r.date === checklistDate).map(res => (
                <div key={res.id} className="flex items-center justify-between p-3 border-b border-stone-100 last:border-0">
                  <div>
                    <div className="font-bold">{res.title}</div>
                    <div className="text-xs text-stone-400">{res.meal_type === 'lunch' ? '昼食' : '夕食'}</div>
                  </div>
                  <button
                    onClick={() => toggleConsumed(res.id, res.consumed)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      res.consumed ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-600'
                    }`}
                  >
                    {res.consumed ? '食事済' : '未完了'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-6 left-4 right-4 p-4 rounded-2xl shadow-lg z-50 flex items-center gap-3 ${
              toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-stone-800 text-white'
            }`}
          >
            {toast.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
            <span className="font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
