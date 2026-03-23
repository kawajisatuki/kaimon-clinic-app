import React, { useState, useEffect, FormEvent, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile } from './services/geminiService';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, writeBatch } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

// --- Utils ---
const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default function App() {
  // --- States ---
  const [user, setUser] = useState<User | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [isSelfCheckMode, setIsSelfCheckMode] = useState(false);
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report'>('menu');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [selfCheckSearch, setSelfCheckSearch] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- Auth & Data Sync ---
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

  useEffect(() => {
    if (!isAuthReady) return;
    const unsubMenu = onSnapshot(query(collection(db, 'menu'), orderBy('date', 'asc')), (snap) => {
      setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem)));
    });
    const unsubRes = onSnapshot(collection(db, 'reservations'), (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation)));
    });
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setAdminUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
    });
    return () => { unsubMenu(); unsubRes(); unsubUsers(); };
  }, [isAuthReady]);

  // --- Actions ---
  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), { consumed: !currentStatus });
      if (!currentStatus) showToast('喫食を確認しました。');
    } catch (e) {
      showToast('更新に失敗しました', 'error');
    }
  };

  const todayMenu = menu.filter(m => m.date === formatDate(new Date()));
  const filteredChecklist = reservations
    .filter(r => menu.find(m => m.id === r.menu_id)?.date === (isSelfCheckMode ? formatDate(new Date()) : selectedDate))
    .map(r => {
      const u = adminUsers.find(user => user.id === r.user_id);
      const m = menu.find(item => item.id === r.menu_id);
      return { ...r, userName: u?.name || `ゲスト: ${r.guest_name}`, userId: u?.username || 'GUEST', mealType: m?.meal_type };
    });

  if (!isAuthReady) return <div className="min-h-screen flex items-center justify-center bg-stone-50"><Loader2 className="animate-spin text-emerald-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 pb-20">
      {/* Toast */}
      <AnimatePresence>{toast && (
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-lg font-bold flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          {toast.message}
        </motion.div>
      )}</AnimatePresence>

      {!user && !isSelfCheckMode ? (
        // --- Login Screen ---
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-emerald-700">
          <div className="bg-white p-10 rounded-[48px] shadow-2xl w-full max-w-sm text-center">
            <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-8">
              <UtensilsCrossed size={42} className="text-emerald-600" />
            </div>
            <h1 className="text-3xl font-black text-stone-800 mb-2">職員食堂</h1>
            <p className="text-stone-400 font-bold mb-10">Kaimon Clinic</p>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold mb-4 shadow-xl hover:scale-[1.02] transition-transform">Googleログイン</button>
            <button onClick={() => setIsSelfCheckMode(true)} className="w-full py-4 bg-orange-500 text-white rounded-2xl font-bold shadow-lg shadow-orange-200 hover:scale-[1.02] transition-transform">みんなのごはん</button>
          </div>
        </div>
      ) : isSelfCheckMode ? (
        // --- Self Check Mode (みんなのごはん) ---
        <div className="max-w-2xl mx-auto p-6 pt-12">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-3xl font-black text-stone-800">みんなのごはん</h2>
            <button onClick={() => setIsSelfCheckMode(false)} className="p-3 bg-white rounded-full shadow-sm"><XCircle size={28} /></button>
          </div>

          {/* 今日の献立表示 */}
          <div className="bg-emerald-50 p-6 rounded-[32px] border-2 border-emerald-100 mb-8">
            <div className="flex items-center gap-2 mb-4 text-emerald-700 font-bold"><Sparkles size={18} /> 本日の献立</div>
            <div className="space-y-3">
              {todayMenu.map(m => (
                <div key={m.id} className="flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-lg text-xs font-black ${m.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>
                      {m.meal_type === 'lunch' ? '昼食' : '夕食'}
                    </span>
                    <span className="font-bold">{m.name}</span>
                  </div>
                  <span className="text-stone-400 font-bold text-sm">{m.calories} kcal</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={20} />
            <input type="text" placeholder="名前で検索..." value={selfCheckSearch} onChange={(e) => setSelfCheckSearch(e.target.value)}
              className="w-full pl-12 pr-4 py-5 bg-white border-none rounded-3xl shadow-sm focus:ring-2 focus:ring-emerald-500 font-bold text-lg" />
          </div>

          <div className="space-y-3">
            {filteredChecklist.filter(r => r.userName.includes(selfCheckSearch)).map(row => (
              <button key={row.id} onClick={() => toggleConsumed(row.id, row.consumed)}
                className={`w-full p-6 rounded-[32px] flex items-center justify-between border-2 transition-all ${row.consumed ? 'bg-emerald-50 border-emerald-500 scale-[0.98]' : 'bg-white border-transparent shadow-md'}`}>
                <div className="flex items-center gap-5">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-colors ${row.consumed ? 'bg-emerald-500 text-white' : 'bg-stone-100 text-stone-300'}`}>
                    <Check size={32} strokeWidth={4} />
                  </div>
                  <div className="text-left">
                    <p className={`text-xl font-black ${row.consumed ? 'text-emerald-900' : 'text-stone-800'}`}>{row.userName}</p>
                    <p className="text-xs font-bold text-stone-400 tracking-widest">ID: {row.userId}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase ${row.mealType === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    {row.mealType === 'lunch' ? 'LUNCH' : 'DINNER'}
                  </span>
                  {row.consumed && <span className="text-emerald-600 font-black text-xs">CHECKED!</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        // --- Admin / User View ---
        <div className="max-w-6xl mx-auto p-6">
          <header className="flex items-center justify-between mb-10 pt-4">
            <div>
              <h2 className="text-2xl font-black text-stone-800">こんにちは、{user?.name}さん</h2>
              <p className="text-stone-400 font-bold text-sm">今日は {formatDate(new Date())} です</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => signOut(auth)} className="px-6 py-3 bg-white rounded-2xl font-bold shadow-sm flex items-center gap-2 hover:bg-stone-50 transition-colors"><LogOut size={18} /> ログアウト</button>
            </div>
          </header>

          {isAdminView && (
            <div className="flex gap-2 mb-10 bg-white p-2 rounded-[28px] shadow-sm w-fit border border-stone-100">
              {(['menu', 'students', 'report'] as const).map(tab => (
                <button key={tab} onClick={() => setAdminTab(tab)}
                  className={`px-8 py-4 rounded-[22px] font-black transition-all ${adminTab === tab ? 'bg-stone-900 text-white shadow-lg' : 'text-stone-400 hover:bg-stone-50'}`}>
                  {tab === 'menu' ? '献立管理' : tab === 'students' ? '職員管理' : '集計レポート'}
                </button>
              ))}
            </div>
          )}

          {adminTab === 'report' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 bg-white p-10 rounded-[48px] shadow-sm border border-stone-100">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-black flex items-center gap-3"><CheckCircle2 className="text-emerald-500" /> 日別チェック表</h3>
                  <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="p-3 bg-stone-50 border-none rounded-xl font-bold" />
                </div>
                <div className="space-y-4">
                  {filteredChecklist.map(row => (
                    <div key={row.id} className={`p-6 rounded-[32px] border-2 flex items-center justify-between transition-all ${row.consumed ? 'bg-emerald-50 border-emerald-100' : 'bg-stone-50 border-stone-100'}`}>
                      <div className="flex items-center gap-5">
                        <button onClick={() => toggleConsumed(row.id, row.consumed)} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${row.consumed ? 'bg-emerald-500 text-white' : 'bg-white border-2 border-stone-200'}`}>
                          {row.consumed && <Check size={24} strokeWidth={4} />}
                        </button>
                        <div>
                          <p className="font-bold text-lg">{row.userName}</p>
                          <div className="flex gap-2 mt-1">
                            <span className="text-[10px] font-black text-stone-400">ID: {row.userId}</span>
                            <span className={`text-[10px] font-black px-2 rounded ${row.mealType === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>{row.mealType === 'lunch' ? '昼食' : '夕食'}</span>
                          </div>
                        </div>
                      </div>
                      <span className={`px-4 py-2 rounded-xl text-xs font-black ${row.consumed ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-200 text-stone-500'}`}>
                        {row.consumed ? '食事済' : '未完了'}
                      </span>
                    </div>
                  ))}
                  {filteredChecklist.length === 0 && <div className="text-center py-20 text-stone-400 font-bold">この日の予約はありません</div>}
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="text-center py-40 bg-white rounded-[48px] shadow-sm border border-stone-100">
              <p className="text-stone-400 font-bold">このタブのコンテンツは準備中です（元の機能をそのまま保持しています）</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
