import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, LogOut, UtensilsCrossed, Loader2, Pencil, Trash2, AlertCircle, Check, Plus, Settings, Sparkles, Download, CheckCircle2, User as UserIcon } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { 
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where 
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

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
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report'>('menu');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        let userData: User;
        if (userDoc.exists()) {
          userData = userDoc.data() as User;
        } else {
          userData = {
            id: firebaseUser.uid,
            username: firebaseUser.email?.split('@')[0] || 'staff',
            name: firebaseUser.displayName || '職員',
            role: firebaseUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'student'
          };
          await setDoc(userDocRef, userData);
        }
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
    const unsubscribeMenu = onSnapshot(query(collection(db, 'menu'), orderBy('date', 'desc')), (snap) => {
      setMenu(snap.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem)));
    });
    const qRes = user.role === 'admin' 
      ? query(collection(db, 'reservations'))
      : query(collection(db, 'reservations'), where('user_id', '==', user.id));
    const unsubscribeRes = onSnapshot(qRes, (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation)));
    });
    return () => { unsubscribeMenu(); unsubscribeRes(); };
  }, [user]);

  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), { consumed: !currentStatus });
      showToast(!currentStatus ? '食事済みとして記録しました' : '記録を取り消しました');
    } catch (e) { showToast('更新に失敗しました', 'error'); }
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

  if (!isAuthReady) return <div className="flex h-screen items-center justify-center bg-stone-50"><Loader2 className="animate-spin text-emerald-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-stone-900">
      <header className="bg-white border-b border-stone-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 p-2 rounded-xl text-white shadow-lg"><UtensilsCrossed size={22} /></div>
          <h1 className="font-black text-xl tracking-tight">開聞クリニック 喫食管理</h1>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <button onClick={() => setIsAdminView(!isAdminView)} className={`p-3 rounded-2xl transition-all ${isAdminView ? 'bg-emerald-600 text-white shadow-xl' : 'bg-stone-50 text-stone-400'}`}><Settings size={22} /></button>
          )}
          {user && <button onClick={() => signOut(auth)} className="p-3 text-stone-300 hover:text-red-500 transition-all"><LogOut size={22} /></button>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-10">
        {!user ? (
          <div className="max-w-md mx-auto mt-24">
            <div className="bg-white p-12 text-center shadow-2xl rounded-[3rem] border border-stone-50">
              <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8"><UserIcon size={40} /></div>
              <h2 className="text-2xl font-black mb-10">職員専用システム</h2>
              <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-5 bg-stone-900 text-white rounded-[1.5rem] flex items-center justify-center gap-4 font-black hover:bg-black transition-all active:scale-95 shadow-xl shadow-stone-200">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="w-6 h-6 bg-white rounded-full p-1" />
                Googleアカウントでログイン
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            {/* 左：献立予約 */}
            <div className="space-y-8">
              <section className="bg-white p-10 rounded-[3rem] shadow-sm border border-stone-50">
                <h3 className="text-2xl font-black flex items-center gap-4 mb-10"><CalendarIcon className="text-emerald-600" size={28} /> 献立カレンダー</h3>
                <div className="bg-emerald-50 rounded-[2.5rem] p-10 border border-emerald-100">
                  <div className="flex items-center justify-between mb-10">
                    <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-white px-8 py-4 rounded-[1.5rem] font-black text-emerald-800 shadow-sm border-none" />
                    <div className="flex bg-white/80 rounded-2xl p-1 shadow-sm">
                      <button onClick={() => setSelectedMealType('lunch')} className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all ${selectedMealType === 'lunch' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-600'}`}>昼食</button>
                      <button onClick={() => setSelectedMealType('dinner')} className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all ${selectedMealType === 'dinner' ? 'bg-emerald-600 text-white shadow-lg' : 'text-emerald-600'}`}>夕食</button>
                    </div>
                  </div>
                  {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                    <div className="space-y-8">
                      <p className="text-4xl font-black text-stone-800 leading-tight text-center">{menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}</p>
                      <button onClick={() => toggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)} className={`w-full py-6 rounded-[2rem] font-black text-xl transition-all shadow-2xl active:scale-95 ${reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? 'bg-rose-500 text-white shadow-rose-100' : 'bg-emerald-600 text-white shadow-emerald-100'}`}>
                        {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? 'この予約をキャンセル' : 'この献立を予約する'}
                      </button>
                    </div>
                  ) : <div className="py-20 text-center text-stone-300 font-black text-lg italic">献立が登録されていません</div>}
                </div>
              </section>
              <section className="bg-white p-8 rounded-[2.5rem] border border-stone-50 flex items-center gap-5 shadow-sm">
                <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center"><Sparkles size={28} /></div>
                <p className="text-stone-400 font-black">今日も美味しく食べて、元気に過ごしましょう！</p>
              </section>
            </div>

            {/* 右：本日の喫食確認 */}
            <section className="bg-white p-10 rounded-[3rem] shadow-sm border border-stone-50 h-fit">
              <h3 className="text-2xl font-black flex items-center gap-4 mb-10"><ClipboardList className="text-emerald-600" size={28} /> 本日の喫食確認</h3>
              <div className="space-y-4">
                {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                  reservations.filter(r => r.date === selectedDate).map(res => (
                    <div key={res.id} className="flex items-center justify-between p-7 bg-stone-50 rounded-[2rem] border border-stone-100 group transition-all">
                      <div className="flex items-center gap-6">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${res.consumed ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-stone-200'}`}><Check size={32} strokeWidth={3} /></div>
                        <div><p className="font-black text-stone-800 text-xl leading-tight">{res.title}</p><p className="text-[10px] font-black text-stone-300 uppercase mt-1 tracking-widest">{res.meal_type === 'lunch' ? 'Lunch' : 'Dinner'}</p></div>
                      </div>
                      <button onClick={() => toggleConsumed(res.id, res.consumed)} className={`px-10 py-4 rounded-2xl font-black text-sm transition-all shadow-md ${res.consumed ? 'bg-emerald-600 text-white shadow-emerald-50' : 'bg-white text-emerald-600 hover:bg-emerald-50'}`}>
                        {res.consumed ? '食事済' : '未完了'}
                      </button>
                    </div>
                  ))
                ) : <div className="py-32 text-center text-stone-200 font-black text-xl tracking-tight">本日の予約はありません</div>}
              </div>
            </section>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} className={`fixed bottom-10 left-4 right-4 md:left-auto md:right-10 md:w-96 p-7 rounded-[2rem] shadow-2xl z-[100] flex items-center gap-5 border border-white/20 backdrop-blur-2xl ${toast.type === 'error' ? 'bg-rose-500 text-white' : 'bg-stone-900 text-white'}`}>
            {toast.type === 'error' ? <AlertCircle size={28} /> : <CheckCircle2 size={28} className="text-emerald-400" />}
            <span className="font-black text-lg">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
