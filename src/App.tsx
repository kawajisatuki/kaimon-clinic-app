import React, { useState, useEffect, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, LogOut, UtensilsCrossed, Loader2, Pencil, Trash2, AlertCircle, Check, Plus, Settings, Sparkles, Download, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { 
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, where 
} from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';

// --- 日付操作の原型復元 ---
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
  const [reportMonth, setReportMonth] = useState(formatDate(new Date()).slice(0, 7));

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- 認証ロジックの原型復元（studentも確実に通す） ---
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

  // --- リアルタイム同期の原型復元 ---
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
    if (user.role === 'admin') {
      const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setAdminUsers(snap.docs.map(d => d.data() as User));
      });
      return () => { unsubscribeMenu(); unsubscribeRes(); unsubscribeUsers(); };
    }
    return () => { unsubscribeMenu(); unsubscribeRes(); };
  }, [user]);

  // --- 【GitHubエラー修正】toggleConsumed ---
  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), { consumed: !currentStatus });
      showToast(!currentStatus ? '喫食を確認しました' : '取り消しました');
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
    <div className="min-h-screen bg-[#FDFCFB] text-stone-900 font-sans">
      <header className="bg-white/80 backdrop-blur-md border-b border-stone-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-2.5 rounded-[1rem] text-white shadow-lg shadow-emerald-100"><UtensilsCrossed size={22} /></div>
          <div>
            <h1 className="font-black text-xl tracking-tight">開聞クリニック</h1>
            <p className="text-[9px] font-black text-stone-300 tracking-[0.2em] uppercase">Dietary Management</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <button onClick={() => setIsAdminView(!isAdminView)} className={`p-3 rounded-2xl transition-all ${isAdminView ? 'bg-emerald-600 text-white shadow-xl' : 'bg-stone-50 text-stone-400 hover:bg-stone-100'}`}><Settings size={22} /></button>
          )}
          {user && (
            <div className="flex items-center gap-3 pl-4 border-l border-stone-100">
              <button onClick={() => signOut(auth)} className="p-3 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all"><LogOut size={22} /></button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-10">
        {!user ? (
          <div className="max-w-md mx-auto mt-24">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white p-12 text-center shadow-[0_20px_50px_rgba(0,0,0,0.05)] rounded-[3rem] border border-stone-50">
              <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8"><UserIcon size={40} /></div>
              <h2 className="text-2xl font-black mb-2">職員ログイン</h2>
              <p className="text-stone-400 text-sm font-bold mb-10">Googleアカウントで認証してください</p>
              <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-5 bg-stone-900 text-white rounded-[1.5rem] flex items-center justify-center gap-4 font-black hover:bg-black transition-all active:scale-95 shadow-xl shadow-stone-200">
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="w-6 h-6 bg-white rounded-full p-1" />
                ログインして開始
              </button>
            </motion.div>
          </div>
        ) : isAdminView ? (
          /* 管理者画面の原型復元 */
          <div className="space-y-8 animate-in fade-in zoom-in duration-500">
            <div className="flex gap-3 p-1.5 bg-stone-100 rounded-[1.5rem] w-fit">
              {(['menu', 'students', 'report'] as const).map(tab => (
                <button key={tab} onClick={() => setAdminTab(tab)} className={`px-10 py-3 rounded-xl font-black text-sm transition-all ${adminTab === tab ? 'bg-white text-emerald-700 shadow-md' : 'text-stone-400 hover:text-stone-600'}`}>
                  {tab === 'menu' ? '献立管理' : tab === 'students' ? '職員名簿' : 'レポート'}
                </button>
              ))}
            </div>
            <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-stone-100 min-h-[600px]">
              {adminTab === 'menu' && (
                <div className="space-y-8">
                  <div className="flex justify-between items-center"><h3 className="text-2xl font-black">献立データの管理</h3><button className="flex items-center gap-2 bg-emerald-600 text-white px-8 py-4 rounded-2xl font-black shadow-lg shadow-emerald-100"><Plus size={20} /> 新規作成</button></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {menu.map(m => (
                      <div key={m.id} className="p-6 bg-stone-50/50 border border-stone-100 rounded-[2rem] group hover:bg-white hover:shadow-xl transition-all">
                        <div className="flex justify-between mb-4"><span className="text-xs font-black text-stone-300 tracking-tighter">{m.date}</span><span className={`px-3 py-1 rounded-full text-[10px] font-black ${m.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>{m.meal_type === 'lunch' ? '昼食' : '夕食'}</span></div>
                        <p className="font-black text-lg text-stone-800 leading-tight mb-6">{m.title}</p>
                        <div className="flex gap-2"><button className="flex-1 py-3 bg-white border border-stone-100 rounded-xl text-xs font-black hover:bg-emerald-50 hover:text-emerald-600 transition-all">編集</button><button className="p-3 text-stone-200 hover:text-red-500"><Trash2 size={20} /></button></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {adminTab === 'students' && (
                <div className="space-y-8">
                  <h3 className="text-2xl font-black text-stone-800">職員名簿（{adminUsers.length}名）</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {adminUsers.map(u => (
                      <div key={u.id} className="p-6 bg-white border border-stone-100 rounded-[2rem] flex justify-between items-center font-black">
                        <div className="flex items-center gap-4"><div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center"><UserIcon size={20} /></div><span>{u.name}</span></div>
                        <span className="text-[10px] bg-stone-50 px-3 py-1 rounded-full text-stone-400">{u.role === 'admin' ? '管理者' : '一般'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {adminTab === 'report' && (
                <div className="py-20 text-center space-y-10">
                  <div className="max-w-md mx-auto p-10 bg-stone-50 rounded-[3rem] border border-dashed border-stone-200">
                    <h3 className="text-xl font-black mb-6 tracking-tight">月間統計レポート</h3>
                    <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className="w-full px-8 py-4 bg-white rounded-2xl font-black border-none shadow-sm mb-6" />
                    <button className="w-full bg-stone-900 text-white py-5 rounded-2xl font-black flex items-center justify-center gap-3 shadow-2xl hover:bg-black transition-all active:scale-95"><Download size={22} /> CSV形式で保存</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 一般職員画面：2カラム原型完全復元 */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in slide-in-from-bottom-6 duration-1000">
            {/* 左：献立予約セクション */}
            <div className="space-y-8">
              <section className="bg-white p-10 rounded-[3rem] shadow-[0_10px_40px_rgba(0,0,0,0.02)] border border-stone-50">
                <div className="flex items-center justify-between mb-10">
                  <h3 className="text-2xl font-black flex items-center gap-4 text-stone-800"><CalendarIcon className="text-emerald-600" size={28} /> 献立予約</h3>
                  <div className="flex gap-2 bg-stone-50 p-1.5 rounded-2xl">
                    <button onClick={() => setSelectedMealType('lunch')} className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all ${selectedMealType === 'lunch' ? 'bg-white text-emerald-600 shadow-sm' : 'text-stone-400'}`}>昼食</button>
                    <button onClick={() => setSelectedMealType('dinner')} className={`px-6 py-2.5 rounded-xl text-sm font-black transition-all ${selectedMealType === 'dinner' ? 'bg-white text-emerald-600 shadow-sm' : 'text-stone-400'}`}>夕食</button>
                  </div>
                </div>
                
                <div className="bg-gradient-to-br from-emerald-50 to-white rounded-[2.5rem] p-10 border border-emerald-100/50 relative overflow-hidden group">
                  <div className="absolute -top-10 -right-10 opacity-5 text-emerald-600 group-hover:scale-110 transition-transform duration-700"><UtensilsCrossed size={200} /></div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-10">
                      <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="bg-white px-8 py-4 rounded-[1.5rem] font-black text-emerald-800 shadow-sm border-none cursor-pointer hover:shadow-md transition-shadow" />
                    </div>
                    {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                      <div className="space-y-8">
                        <div className="space-y-3">
                          <p className="text-emerald-500 font-black text-xs uppercase tracking-widest">Selected Menu</p>
                          <p className="text-4xl font-black text-stone-800 leading-[1.2]">{menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}</p>
                        </div>
                        <button onClick={() => toggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)} className={`w-full py-6 rounded-[2rem] font-black text-xl transition-all shadow-2xl active:scale-[0.97] ${reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? 'bg-rose-500 text-white shadow-rose-100' : 'bg-emerald-600 text-white shadow-emerald-100 hover:bg-emerald-700'}`}>
                          {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) ? '予約をキャンセルする' : 'この献立で予約を確定'}
                        </button>
                      </div>
                    ) : (
                      <div className="py-20 text-center bg-white/50 rounded-[2rem] border-2 border-dashed border-emerald-100 flex flex-col items-center gap-4">
                        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-emerald-100"><CalendarIcon size={32} /></div>
                        <p className="text-emerald-800/30 font-black text-lg italic tracking-tight">献立がまだ登録されていません</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
              
              <section className="bg-white p-8 rounded-[2.5rem] border border-stone-50 shadow-sm flex items-start gap-5">
                <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"><Sparkles size={28} /></div>
                <div>
                  <h4 className="font-black text-stone-800 mb-1">AI 栄養ワンポイント</h4>
                  <p className="text-stone-400 font-bold leading-relaxed">今日も一日お疲れ様です。バランスの良い食事で午後の業務も健やかに！</p>
                </div>
              </section>
            </div>

            {/* 右：本日の喫食確認セクション */}
            <section className="bg-white p-10 rounded-[3rem] shadow-[0_10px_40px_rgba(0,0,0,0.02)] border border-stone-50 h-fit">
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-2xl font-black flex items-center gap-4 text-stone-800"><ClipboardList className="text-emerald-600" size={28} /> 喫食の確認</h3>
                <div className="px-5 py-2 bg-stone-50 text-stone-300 rounded-full text-[10px] font-black tracking-widest uppercase">Realtime</div>
              </div>
              <div className="space-y-4">
                {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                  reservations.filter(r => r.date === selectedDate).map(res => (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} key={res.id} className="flex items-center justify-between p-7 bg-white border border-stone-100 rounded-[2rem] hover:shadow-xl hover:border-emerald-100 transition-all group">
                      <div className="flex items-center gap-6">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${res.consumed ? 'bg-emerald-100 text-emerald-600 shadow-inner' : 'bg-stone-50 text-stone-200'}`}>
                          <Check size={32} strokeWidth={3} />
                        </div>
                        <div>
                          <p className="font-black text-stone-800 text-xl leading-tight mb-1">{res.title}</p>
                          <p className="text-[10px] font-black text-stone-300 tracking-[0.2em] uppercase">{res.meal_type === 'lunch' ? 'Lunch / 昼食' : 'Dinner / 夕食'}</p>
                        </div>
                      </div>
                      <button onClick={() => toggleConsumed(res.id, res.consumed)} className={`px-10 py-4 rounded-2xl font-black text-sm transition-all shadow-md active:scale-95 ${res.consumed ? 'bg-emerald-600 text-white shadow-emerald-50' : 'bg-white text-emerald-600 border border-emerald-50 hover:bg-emerald-50'}`}>
                        {res.consumed ? '食事済' : '未完了'}
                      </button>
                    </motion.div>
                  ))
                ) : (
                  <div className="py-32 text-center flex flex-col items-center gap-6">
                    <div className="w-24 h-24 bg-stone-50 rounded-[2.5rem] flex items-center justify-center text-stone-100"><CalendarIcon size={40} /></div>
                    <p className="text-stone-200 font-black text-xl tracking-tight">本日の予約データはありません</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 50, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className={`fixed bottom-10 left-4 right-4 md:left-auto md:right-10 md:w-96 p-7 rounded-[2rem] shadow-[0_20px_60px_rgba(0,0,0,0.15)] z-[100] flex items-center gap-5 border border-white/20 backdrop-blur-2xl ${toast.type === 'error' ? 'bg-rose-500 text-white' : 'bg-stone-900 text-white'}`}>
            {toast.type === 'error' ? <AlertCircle size={28} /> : <CheckCircle2 size={28} className="text-emerald-400" />}
            <span className="font-black text-lg">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const UserIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
);
