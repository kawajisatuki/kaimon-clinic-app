import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save, X } from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile } from './services/geminiService';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, writeBatch } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
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
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report'>('menu');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  
  // フォーム用State
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Partial<MenuItem> | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- Auth & Sync ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const d = await getDoc(doc(db, 'users', fbUser.uid));
        if (d.exists()) {
          const u = d.data() as User;
          setUser(u);
          setIsAdminView(u.role === 'admin');
        }
      } else {
        setUser(null);
        setIsAdminView(false);
      }
      setIsAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!isAuthReady) return;
    const qM = query(collection(db, 'menu'), orderBy('date', 'asc'));
    const unsubM = onSnapshot(qM, (s) => setMenu(s.docs.map(d => ({ id: d.id, ...d.data() } as MenuItem))));
    const unsubR = onSnapshot(collection(db, 'reservations'), (s) => setReservations(s.docs.map(d => ({ id: d.id, ...d.data() } as Reservation))));
    const unsubU = onSnapshot(collection(db, 'users'), (s) => setAdminUsers(s.docs.map(d => ({ id: d.id, ...d.data() } as User))));
    return () => { unsubM(); unsubR(); unsubU(); };
  }, [isAuthReady]);

  // --- Actions ---
  const handleSaveMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMenu?.date || !editingMenu?.name) return;
    try {
      const id = editingMenu.id || `${editingMenu.date}-${editingMenu.meal_type}`;
      await setDoc(doc(db, 'menu', id), { ...editingMenu, id }, { merge: true });
      showToast('献立を保存しました');
      setIsMenuModalOpen(false);
      setEditingMenu(null);
    } catch (e) { showToast('保存に失敗しました', 'error'); }
  };

  const deleteMenu = async (id: string) => {
    if (!confirm('削除してよろしいですか？')) return;
    await deleteDoc(doc(db, 'menu', id));
    showToast('削除しました');
  };

  const toggleConsumed = async (resId: string, currentStatus: boolean) => {
    await updateDoc(doc(db, 'reservations', resId), { consumed: !currentStatus });
  };

  if (!isAuthReady) return <div className="min-h-screen flex items-center justify-center bg-stone-50"><Loader2 className="animate-spin text-emerald-600" /></div>;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 pb-20">
      <AnimatePresence>{toast && (
        <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-lg font-bold flex items-center gap-2 ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          {toast.message}
        </motion.div>
      )}</AnimatePresence>

      {!user ? (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-emerald-700">
          <div className="bg-white p-12 rounded-[50px] shadow-2xl w-full max-w-md text-center">
            <h1 className="text-3xl font-black mb-10">職員食堂システム</h1>
            <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} className="w-full py-5 bg-stone-900 text-white rounded-[24px] font-black shadow-xl">Googleでログイン</button>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto p-8">
          <header className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-100">
                <UtensilsCrossed size={30} />
              </div>
              <div>
                <h2 className="text-2xl font-black text-stone-800">こんにちは、{user.name}さん</h2>
                <p className="text-stone-400 font-bold text-sm">Kaimon Clinic Dining</p>
              </div>
            </div>
            <button onClick={() => signOut(auth)} className="px-6 py-3 bg-white rounded-2xl font-bold shadow-sm border border-stone-100 hover:bg-stone-50 transition-all flex items-center gap-2 text-stone-500"><LogOut size={18} /> ログアウト</button>
          </header>

          {isAdminView && (
            <div className="flex gap-2 mb-10 bg-white p-2 rounded-[30px] shadow-sm border border-stone-100 w-fit">
              {(['menu', 'students', 'report'] as const).map(tab => (
                <button key={tab} onClick={() => setAdminTab(tab)}
                  className={`px-10 py-4 rounded-[22px] font-black transition-all ${adminTab === tab ? 'bg-stone-900 text-white shadow-lg' : 'text-stone-400 hover:bg-stone-50'}`}>
                  {tab === 'menu' ? '献立管理' : tab === 'students' ? '職員管理' : '集計レポート'}
                </button>
              ))}
            </div>
          )}

          {/* 各タブのコンテンツ */}
          {adminTab === 'menu' ? (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-black">登録済み献立</h3>
                <button onClick={() => { setEditingMenu({ date: formatDate(new Date()), meal_type: 'lunch', calories: 600 }); setIsMenuModalOpen(true); }} className="px-6 py-3 bg-emerald-600 text-white rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-100"><Plus size={20} /> 新規追加</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {menu.map(m => (
                  <div key={m.id} className="bg-white p-6 rounded-[32px] shadow-sm border border-stone-100 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-4">
                      <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase ${m.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>{m.meal_type === 'lunch' ? 'LUNCH' : 'DINNER'}</span>
                      <div className="flex gap-2">
                        <button onClick={() => { setEditingMenu(m); setIsMenuModalOpen(true); }} className="p-2 text-stone-400 hover:text-emerald-600 bg-stone-50 rounded-lg"><Pencil size={16} /></button>
                        <button onClick={() => deleteMenu(m.id)} className="p-2 text-stone-400 hover:text-red-600 bg-stone-50 rounded-lg"><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <p className="text-stone-400 text-xs font-bold mb-1">{m.date}</p>
                    <h4 className="text-xl font-black text-stone-800 mb-4">{m.name}</h4>
                    <div className="flex items-center gap-4 text-sm font-bold text-stone-500">
                      <span className="flex items-center gap-1"><History size={14} /> {m.calories}kcal</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : adminTab === 'students' ? (
            <div className="bg-white rounded-[40px] p-8 border border-stone-100 shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-black">登録職員一覧</h3>
                <div className="flex gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
                    <input type="text" placeholder="名前で検索..." className="pl-10 pr-4 py-2 bg-stone-50 rounded-xl border-none font-bold" />
                  </div>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl border border-stone-50">
                <table className="w-full text-left">
                  <thead className="bg-stone-50 text-stone-400 text-xs font-black uppercase tracking-wider">
                    <tr>
                      <th className="px-6 py-4">名前</th>
                      <th className="px-6 py-4">ユーザーID</th>
                      <th className="px-6 py-4">権限</th>
                      <th className="px-6 py-4">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {adminUsers.map(u => (
                      <tr key={u.id} className="hover:bg-stone-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold">{u.name}</td>
                        <td className="px-6 py-4 font-mono text-stone-400 text-sm">{u.username}</td>
                        <td className="px-6 py-4"><span className={`px-3 py-1 rounded-full text-[10px] font-black ${u.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>{u.role}</span></td>
                        <td className="px-6 py-4"><button className="text-stone-400 hover:text-stone-800 transition-colors"><Settings size={18} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-10">
                <h3 className="text-2xl font-black">日別チェック表</h3>
                <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="p-3 bg-white rounded-xl font-bold border-2 border-stone-100" />
              </div>
              <div className="grid gap-4">
                {reservations
                  .filter(r => menu.find(m => m.id === r.menu_id)?.date === selectedDate)
                  .map(r => {
                    const u = adminUsers.find(user => user.id === r.user_id);
                    const m = menu.find(item => item.id === r.menu_id);
                    return (
                      <div key={r.id} className={`p-6 rounded-[32px] border-2 flex items-center justify-between transition-all ${r.consumed ? 'bg-emerald-50 border-emerald-100 shadow-sm' : 'bg-white border-stone-100 shadow-sm'}`}>
                        <div className="flex items-center gap-6">
                          <button onClick={() => toggleConsumed(r.id, r.consumed)} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${r.consumed ? 'bg-emerald-500 text-white shadow-lg' : 'bg-stone-50 text-stone-200 hover:bg-stone-100'}`}>
                            <Check size={28} strokeWidth={4} />
                          </button>
                          <div>
                            <p className="text-xl font-black">{u?.name || `ゲスト: ${r.guest_name}`}</p>
                            <div className="flex gap-2 mt-1">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black ${m?.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>{m?.meal_type === 'lunch' ? '昼食' : '夕食'}</span>
                              <span className="text-[10px] font-black text-stone-400 tracking-tighter uppercase">ID: {u?.username || 'GUEST'}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-4 py-2 rounded-xl text-xs font-black ${r.consumed ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-400'}`}>{r.consumed ? '食事済' : '未完了'}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal - 献立登録/編集 */}
      <AnimatePresence>
        {isMenuModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-stone-900/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white w-full max-w-lg rounded-[40px] p-10 shadow-2xl relative">
              <button onClick={() => setIsMenuModalOpen(false)} className="absolute top-8 right-8 text-stone-400 hover:text-stone-800"><X size={24} /></button>
              <h3 className="text-2xl font-black mb-8">献立の{editingMenu?.id ? '編集' : '登録'}</h3>
              <form onSubmit={handleSaveMenu} className="space-y-6">
                <div>
                  <label className="block text-sm font-black text-stone-400 mb-2 uppercase">日付</label>
                  <input type="date" required value={editingMenu?.date || ''} onChange={e => setEditingMenu({...editingMenu, date: e.target.value})} className="w-full p-4 bg-stone-50 rounded-2xl border-none font-bold" />
                </div>
                <div>
                  <label className="block text-sm font-black text-stone-400 mb-2 uppercase">区分</label>
                  <div className="flex gap-4">
                    {(['lunch', 'dinner'] as const).map(type => (
                      <button key={type} type="button" onClick={() => setEditingMenu({...editingMenu, meal_type: type})} className={`flex-1 py-4 rounded-2xl font-black transition-all ${editingMenu?.meal_type === type ? 'bg-stone-900 text-white shadow-lg' : 'bg-stone-50 text-stone-400 hover:bg-stone-100'}`}>{type === 'lunch' ? '昼食' : '夕食'}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-black text-stone-400 mb-2 uppercase">メニュー名</label>
                  <input type="text" required placeholder="例: 鶏肉のバジル焼き" value={editingMenu?.name || ''} onChange={e => setEditingMenu({...editingMenu, name: e.target.value})} className="w-full p-4 bg-stone-50 rounded-2xl border-none font-bold" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-black text-stone-400 mb-2 uppercase">カロリー</label>
                    <input type="number" value={editingMenu?.calories || 0} onChange={e => setEditingMenu({...editingMenu, calories: Number(e.target.value)})} className="w-full p-4 bg-stone-50 rounded-2xl border-none font-bold" />
                  </div>
                </div>
                <button type="submit" className="w-full py-5 bg-emerald-600 text-white rounded-[24px] font-black shadow-lg shadow-emerald-100 hover:scale-[1.02] transition-transform flex items-center justify-center gap-2"><Save size={20} /> 保存する</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
