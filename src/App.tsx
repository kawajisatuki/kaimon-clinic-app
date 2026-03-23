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
  if (toastFn) toastFn(`エラーが発生しました: ${errorMsg.substring(0, 50)}`, "error");
}

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [isSelfCheckMode, setIsSelfCheckMode] = useState(false);
  const [selfCheckSearch, setSelfCheckSearch] = useState('');
  const [selfCheckMealFilter, setSelfCheckMealFilter] = useState<'all' | 'lunch' | 'dinner'>('all');
  const [dailyChecklist, setDailyChecklist] = useState<any[]>([]);
  const [checklistDate, setChecklistDate] = useState(formatDate(new Date()));
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report'>('menu');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Auth
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
    const unsubMenu = onSnapshot(query(collection(db, 'menu'), orderBy('date', 'asc')), (snap) => {
      setMenu(snap.docs.map(d => d.data() as MenuItem));
    });
    const unsubRes = onSnapshot(collection(db, 'reservations'), (snap) => {
      setReservations(snap.docs.map(d => d.data() as Reservation));
    });
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setAdminUsers(snap.docs.map(d => d.data() as User));
    });
    return () => { unsubMenu(); unsubRes(); unsubUsers(); };
  }, [isAuthReady]);

  // Checklist Logic
  useEffect(() => {
    const dayMenuIds = menu.filter(m => m.date === checklistDate).map(m => m.id);
    const checklist = reservations
      .filter(r => dayMenuIds.includes(r.menu_id))
      .map(r => ({
        id: r.id,
        name: adminUsers.find(u => u.id === r.user_id)?.name || `ゲスト: ${r.guest_name}`,
        username: adminUsers.find(u => u.id === r.user_id)?.username || 'GUEST',
        consumed: r.consumed,
        meal_type: menu.find(m => m.id === r.menu_id)?.meal_type || 'lunch'
      }));
    setDailyChecklist(checklist);
  }, [menu, reservations, adminUsers, checklistDate]);

  const toggleConsumed = async (reservationId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', reservationId), { consumed: !currentStatus });
      if (!currentStatus) showToast('喫食を確認しました。');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `reservations/${reservationId}`, showToast);
    }
  };

  if (!isAuthReady) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-emerald-600" /></div>;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 pb-20">
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-lg font-bold flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 表示切り替え */}
      {!user && !isSelfCheckMode ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-emerald-700">
           <div className="bg-white p-8 rounded-[40px] shadow-2xl w-full max-w-sm text-center">
            <h1 className="text-2xl font-black text-stone-800 mb-8">職員食堂システム</h1>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold mb-4">ログイン</button>
            <button onClick={() => setIsSelfCheckMode(true)} className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold">みんなのごはん</button>
          </div>
        </div>
      ) : isSelfCheckMode ? (
        <div className="max-w-2xl mx-auto p-6 pt-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-black text-stone-800">喫食チェック</h2>
            <button onClick={() => setIsSelfCheckMode(false)} className="p-2"><XCircle size={32} /></button>
          </div>
          <div className="bg-white p-6 rounded-[32px] shadow-sm mb-6">
            <input type="text" placeholder="検索..." value={selfCheckSearch} onChange={(e) => setSelfCheckSearch(e.target.value)}
              className="w-full p-4 bg-stone-50 rounded-2xl mb-4" />
          </div>
          <div className="space-y-3">
            {dailyChecklist.filter(row => row.name.includes(selfCheckSearch)).map(row => (
              <button key={row.id} onClick={() => toggleConsumed(row.id, row.consumed)}
                className={`w-full p-5 rounded-3xl flex items-center justify-between border-2 transition-all ${row.consumed ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-stone-100 shadow-sm'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${row.consumed ? 'bg-emerald-500 text-white' : 'bg-stone-100'}`}>
                    {row.consumed ? <Check size={28} /> : null}
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-lg">{row.name}</p>
                    <p className="text-xs text-stone-400">ID: {row.username}</p>
                  </div>
                </div>
                <span className="text-xs font-black px-2 py-1 bg-stone-100 rounded">{row.meal_type === 'lunch' ? '昼食' : '夕食'}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto p-6">
          {/* 管理画面ナビゲーション */}
          {isAdminView && (
            <div className="flex gap-4 mb-8 bg-white p-2 rounded-3xl shadow-sm w-fit">
              <button onClick={() => setAdminTab('menu')} className={`px-6 py-3 rounded-2xl font-bold ${adminTab === 'menu' ? 'bg-stone-900 text-white' : ''}`}>献立管理</button>
              <button onClick={() => setAdminTab('students')} className={`px-6 py-3 rounded-2xl font-bold ${adminTab === 'students' ? 'bg-stone-900 text-white' : ''}`}>職員管理</button>
              <button onClick={() => setAdminTab('report')} className={`px-6 py-3 rounded-2xl font-bold ${adminTab === 'report' ? 'bg-emerald-600 text-white' : ''}`}>集計レポート</button>
            </div>
          )}

          {/* 集計レポート画面の再現 */}
          {isAdminView && adminTab === 'report' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white p-8 rounded-[40px] shadow-sm border border-stone-100">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-2xl font-black">日別チェック表</h3>
                  <input type="date" value={checklistDate} onChange={(e) => setChecklistDate(e.target.value)} className="p-2 border rounded-xl" />
                </div>
                <div className="space-y-4">
                  {dailyChecklist.map(row => (
                    <div key={row.id} className={`p-4 rounded-3xl border flex items-center justify-between ${row.consumed ? 'bg-emerald-50 border-emerald-200' : 'bg-stone-50 border-stone-100'}`}>
                      <div className="flex items-center gap-3">
                        <div onClick={() => toggleConsumed(row.id, row.consumed)} className="cursor-pointer">
                          {row.consumed ? <CheckCircle2 className="text-emerald-600" /> : <div className="w-6 h-6 border-2 rounded-full border-stone-300" />}
                        </div>
                        <span className="font-bold">{row.name}</span>
                        <span className="text-xs px-2 py-1 bg-white rounded shadow-sm">{row.meal_type === 'lunch' ? '昼食' : '夕食'}</span>
                      </div>
                      <span className="text-sm font-bold text-stone-400">{row.consumed ? '食事済' : '未完了'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-20">
              <h2 className="text-2xl font-bold mb-4">こんにちは、{user?.name}さん</h2>
              <button onClick={() => signOut(auth)} className="px-8 py-3 bg-stone-200 rounded-2xl font-bold">ログアウト</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
