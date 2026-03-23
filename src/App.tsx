import React, { useState, useEffect, FormEvent, useRef, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile } from './services/geminiService';
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
  signInWithPopup, 
  onAuthStateChanged, 
  signOut
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
  const errorMsg = error instanceof Error ? error.message : String(error);
  console.error(`Firestore Error (${operationType}):`, errorMsg);
  if (toastFn) {
    if (errorMsg.includes('permission-denied')) {
      toastFn("権限がありません。ログイン状態を確認してください。", "error");
    } else {
      toastFn(`エラーが発生しました: ${errorMsg.substring(0, 50)}`, "error");
    }
  }
}

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// --- Main Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [advice, setAdvice] = useState<string>("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [isSelfCheckMode, setIsSelfCheckMode] = useState(false);
  const [selfCheckSearch, setSelfCheckSearch] = useState('');
  const [selfCheckMealFilter, setSelfCheckMealFilter] = useState<'all' | 'lunch' | 'dinner'>('all');
  const [dailyChecklist, setDailyChecklist] = useState<any[]>([]);
  const [checklistDate, setChecklistDate] = useState(formatDate(new Date()));
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data() as User;
          setUser(userData);
          setIsAdminView(userData.role === 'admin');
        }
      } else {
        setUser(null);
        setIsAdminView(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Data Sync
  useEffect(() => {
    if (!isAuthReady) return;
    const qMenu = query(collection(db, 'menu'), orderBy('date', 'asc'));
    const unsubscribeMenu = onSnapshot(qMenu, (snap) => {
      setMenu(snap.docs.map(d => d.data() as MenuItem));
    });

    const qRes = query(collection(db, 'reservations'));
    const unsubscribeRes = onSnapshot(qRes, (snap) => {
      setReservations(snap.docs.map(d => d.data() as Reservation));
    });

    const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setAdminUsers(snap.docs.map(d => d.data() as User));
    });

    return () => {
      unsubscribeMenu();
      unsubscribeRes();
      unsubscribeUsers();
    };
  }, [isAuthReady]);

  // ★【流用のキモ】集計リストの作成（reservationsが変わると自動更新される）
  useEffect(() => {
    const dayMenus = menu.filter(m => m.date === checklistDate);
    const dayMenuIds = dayMenus.map(m => m.id);
    
    const checklist = reservations
      .filter(r => dayMenuIds.includes(r.menu_id))
      .map(r => {
        const u = adminUsers.find(user => user.id === r.user_id);
        const m = menu.find(item => item.id === r.menu_id);
        return {
          id: r.id,
          name: u ? u.name : `ゲスト: ${r.guest_name}`,
          username: u ? u.username : 'GUEST',
          consumed: r.consumed,
          meal_type: m?.meal_type || 'lunch'
        };
      });
    setDailyChecklist(checklist);
  }, [menu, reservations, adminUsers, checklistDate]);

  // ★【流用のキモ】チェックボタンの処理
  const toggleConsumed = async (reservationId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', reservationId), {
        consumed: !currentStatus
      });
      // ステートを直接更新して即時反映させる
      setReservations(prev => prev.map(res => 
        res.id === reservationId ? { ...res, consumed: !currentStatus } : res
      ));
      if (!currentStatus) showToast('喫食を確認しました。');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `reservations/${reservationId}`, showToast);
    }
  };

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  if (!isAuthReady) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 pb-20">
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-lg font-bold flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main UI */}
      {!user && !isSelfCheckMode ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-emerald-700">
          <div className="bg-white p-8 rounded-[40px] shadow-2xl w-full max-w-sm text-center">
            <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <UtensilsCrossed size={40} className="text-emerald-600" />
            </div>
            <h1 className="text-2xl font-black text-stone-800 mb-2 tracking-tight">かいもんクリニック</h1>
            <p className="text-stone-500 mb-8 font-medium">職員食堂予約システム</p>
            <button onClick={handleGoogleLogin} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold mb-4 flex items-center justify-center gap-2">
              Googleでログイン
            </button>
            <button onClick={() => setIsSelfCheckMode(true)} className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold shadow-lg shadow-orange-200">
              みんなのごはん（喫食チェック）
            </button>
          </div>
        </div>
      ) : isSelfCheckMode ? (
        <div className="max-w-2xl mx-auto p-6 pt-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-black text-stone-800 tracking-tight">喫食チェック</h2>
            <button onClick={() => setIsSelfCheckMode(false)} className="p-2 hover:bg-stone-200 rounded-full transition-all"><XCircle size={32} /></button>
          </div>
          
          <div className="bg-white p-6 rounded-[32px] shadow-sm border border-stone-100 mb-6">
            <div className="relative mb-4">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={20} />
              <input type="text" placeholder="名前やIDで検索..." value={selfCheckSearch} onChange={(e) => setSelfCheckSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-stone-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 font-medium" />
            </div>
            <div className="flex gap-2">
              {(['all', 'lunch', 'dinner'] as const).map(type => (
                <button key={type} onClick={() => setSelfCheckMealFilter(type)}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${selfCheckMealFilter === type ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-500'}`}>
                  {type === 'all' ? 'すべて' : type === 'lunch' ? '昼食' : '夕食'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {dailyChecklist
              .filter(row => {
                const matchesSearch = row.name.toLowerCase().includes(selfCheckSearch.toLowerCase()) || row.username.toLowerCase().includes(selfCheckSearch.toLowerCase());
                const matchesMeal = selfCheckMealFilter === 'all' || row.meal_type === selfCheckMealFilter;
                return matchesSearch && matchesMeal;
              })
              .map(row => (
                <button key={row.id} onClick={() => toggleConsumed(row.id, row.consumed)}
                  className={`w-full p-5 rounded-3xl flex items-center justify-between transition-all border-2 ${row.consumed ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-stone-100 shadow-sm'}`}>
                  <div className="flex items-center gap-4 text-left">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${row.consumed ? 'bg-emerald-500 text-white' : 'bg-stone-100 text-stone-400'}`}>
                      {row.consumed ? <Check size={28} strokeWidth={3} /> : <div className="w-2 h-2 bg-stone-300 rounded-full" />}
                    </div>
                    <div>
                      <p className={`text-xl font-bold ${row.consumed ? 'text-emerald-900' : 'text-stone-800'}`}>{row.name}</p>
                      <p className="text-xs font-bold text-stone-400">ID: {row.username}</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-lg text-xs font-black uppercase ${row.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    {row.meal_type === 'lunch' ? '昼食' : '夕食'}
                  </span>
                </button>
              ))}
          </div>
        </div>
      ) : (
        /* 通常の予約画面（ログイン後）は、長くなるため簡略化していますが、
           isAdminViewなどの条件で既存のUIを表示するように構成してください */
        <div className="p-6 text-center">
          <h1 className="text-xl font-bold">ログイン中: {user?.name}</h1>
          <button onClick={() => signOut(auth)} className="mt-4 px-6 py-2 bg-stone-200 rounded-xl">ログアウト</button>
        </div>
      )}
    </div>
  );
}
