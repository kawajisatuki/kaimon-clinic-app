import React, { useState, useEffect, FormEvent, useRef, ReactNode, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar as CalendarIcon, ClipboardList, User as UserIcon, LogOut, 
  ChevronLeft, ChevronRight, Info, CheckCircle2, XCircle, UtensilsCrossed, 
  Upload, Loader2, FileText, Pencil, Trash2, AlertCircle, Check, 
  Search, Plus, Settings, Users, History, Sparkles, Link as LinkIcon, Save, Download, FileDown 
} from 'lucide-react';
import { User, MenuItem, Reservation } from './types';
import { getMenuAdvice, extractMenuFromFile, analyzeMenuFromText, validateApiKey } from './services/geminiService';
import { 
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, 
  onSnapshot, query, where, orderBy, limit, writeBatch, getDocFromServer, Timestamp 
} from 'firebase/firestore';
import { 
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, signInAnonymously 
} from 'firebase/auth';
import { db, auth } from './firebase';

// ==========================================
// 1. 原型継承: エラーハンドリング・ロジック
// ==========================================
enum OperationType { 
  CREATE = 'create', 
  UPDATE = 'update', 
  DELETE = 'delete', 
  LIST = 'list', 
  GET = 'get', 
  WRITE = 'write' 
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: { providerId: string; displayName: string | null; email: string | null; photoUrl: string | null; }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, toastFn?: (msg: string, type?: 'success' | 'error') => void) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || 'anonymous',
      email: auth.currentUser?.email || 'no-email',
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || false,
      tenantId: auth.currentUser?.tenantId || 'none',
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId, displayName: provider.displayName || '', email: provider.email || '', photoUrl: provider.photoURL || ''
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Detailed:', JSON.stringify(errInfo, null, 2));
  if (toastFn) {
    if (errInfo.error.includes('permission-denied')) toastFn("アクセス権限がありません。管理者に確認してください。", "error");
    else if (errInfo.error.includes('unavailable')) toastFn("サーバーと通信できません。電波状況を確認してください。", "error");
    else toastFn(`エラーが発生しました: ${errInfo.error.substring(0, 50)}`, "error");
  }
}

// ==========================================
// 2. 原型継承: ユーティリティ & ErrorBoundary
// ==========================================
class ErrorBoundary extends React.Component<{children: ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-100 p-6">
          <div className="bg-white p-12 max-w-lg w-full text-center rounded-[3.5rem] shadow-2xl border border-red-50">
            <AlertCircle size={80} className="text-red-500 mx-auto mb-8" />
            <h1 className="text-3xl font-black mb-4">システムエラー</h1>
            <p className="text-stone-500 mb-8 leading-relaxed font-bold">申し訳ありません。予期せぬエラーが発生しました。<br/>画面を更新しても直らない場合は管理者に連絡してください。</p>
            <div className="bg-red-50 p-6 rounded-2xl text-red-700 text-xs mb-10 text-left font-mono overflow-auto max-h-40 border border-red-100">
              {this.state.error?.toString()}
            </div>
            <button onClick={() => window.location.reload()} className="w-full py-6 bg-stone-900 text-white rounded-3xl font-black text-xl hover:bg-stone-800 shadow-xl transition-all active:scale-95">
              アプリを再起動する
            </button>
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

const safeStorage = {
  getItem: (key: string) => { try { return localStorage.getItem(key); } catch (e) { return null; } },
  setItem: (key: string, value: string) => { try { localStorage.setItem(key, value); } catch (e) {} },
};

// ==========================================
// 3. メインアプリケーション
// ==========================================
export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  // --- [ステート] 原型の全変数を維持 ---
  const [user, setUser] = useState<User | null>(null);
  const [isAdminView, setIsAdminView] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report' | 'settings'>('menu');
  const [reportMonth, setReportMonth] = useState(formatDate(new Date()).slice(0, 7));
  const [monthlyReport, setMonthlyReport] = useState<any[]>([]);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [manualApiKey, setManualApiKey] = useState<string>(() => safeStorage.getItem('manual_gemini_api_key') || '');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // --- [エフェクト] APIキーのグローバル同期 ---
  useEffect(() => {
    // @ts-ignore
    window._manual_api_key = manualApiKey;
    if (manualApiKey) safeStorage.setItem('manual_gemini_api_key', manualApiKey);
  }, [manualApiKey]);

  // --- [エフェクト] Firebase 認証 & ユーザープロフィール初期化 ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const userDocRef = doc(db, 'users', fbUser.uid);
          const uDoc = await getDoc(userDocRef);
          if (uDoc.exists()) {
            setUser(uDoc.data() as User);
          } else {
            const newUser: User = {
              id: fbUser.uid,
              username: fbUser.email?.split('@')[0] || fbUser.uid,
              name: fbUser.displayName || '名無しさん',
              role: fbUser.email === 'satukikawaji@gmail.com' ? 'admin' : 'student',
              createdAt: Timestamp.now()
            };
            await setDoc(userDocRef, newUser);
            setUser(newUser);
          }
        } catch (e) { 
          handleFirestoreError(e, OperationType.GET, 'users', showToast); 
        }
      } else { 
        setUser(null); 
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- [エフェクト] 【核心】Firebase リアルタイム同期リスナー ---
  useEffect(() => {
    if (!isAuthReady) return;

    // 1. 献立のリアルタイム購読
    const qMenu = query(collection(db, 'menu'), orderBy('date', 'asc'));
    const unsubMenu = onSnapshot(qMenu, (snap) => {
      const menuData = snap.docs.map(d => ({ ...d.data(), id: d.id } as MenuItem));
      setMenu(menuData);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'menu'));

    // 2. 予約のリアルタイム購読（管理者は全件、一般は自分のみ）
    let qRes = user?.role === 'admin' 
      ? query(collection(db, 'reservations'), orderBy('date', 'desc'))
      : query(collection(db, 'reservations'), where('user_id', '==', user?.id || ''));
    
    const unsubRes = onSnapshot(qRes, (snap) => {
      const resData = snap.docs.map(d => ({ ...d.data(), id: d.id } as Reservation));
      setReservations(resData);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'reservations'));

    // 3. 管理者用：ユーザーリストのリアルタイム購読
    let unsubUsers = () => {};
    if (user?.role === 'admin') {
      unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setAdminUsers(snap.docs.map(d => d.data() as User));
      });
    }

    // クリーンアップ関数（これが無いとメモリリークや重複リスナーが発生する）
    return () => { 
      unsubMenu(); 
      unsubRes(); 
      unsubUsers(); 
    };
  }, [isAuthReady, user]);

  // --- [エフェクト] 管理者用：月次レポートの自動集計 ---
  useEffect(() => {
    if (user?.role === 'admin' && adminUsers.length > 0) {
      const students = adminUsers.filter(u => u.role === 'student');
      const report = students.map(u => {
        // 対象月の予約をフィルタリング
        const uRes = reservations.filter(r => r.user_id === u.id && r.date?.startsWith(reportMonth));
        return {
          id: u.id,
          name: u.name,
          lunch_count: uRes.filter(r => r.meal_type === 'lunch').length,
          lunch_consumed: uRes.filter(r => r.meal_type === 'lunch' && r.consumed).length,
          dinner_count: uRes.filter(r => r.meal_type === 'dinner').length,
          dinner_consumed: uRes.filter(r => r.meal_type === 'dinner' && r.consumed).length,
        };
      });
      setMonthlyReport(report);
    }
  }, [adminUsers, reservations, reportMonth, user]);

  // ==========================================
  // 4. アクション・ロジック
  // ==========================================

  // 予約の切り替え
  const handleToggleReservation = async (menuItem: MenuItem) => {
    if (!user) return showToast('ログインが必要です', 'error');
    const resId = `${user.id}_${menuItem.id}`;
    const exists = reservations.find(r => r.id === resId);

    try {
      if (exists) {
        await deleteDoc(doc(db, 'reservations', resId));
        showToast('予約を取り消しました');
      } else {
        const newReservation: Reservation = {
          id: resId,
          user_id: user.id,
          user_name: user.name,
          menu_id: menuItem.id,
          title: menuItem.title,
          date: menuItem.date,
          meal_type: menuItem.meal_type,
          consumed: false,
          status: 'reserved',
          createdAt: Timestamp.now()
        };
        await setDoc(doc(db, 'reservations', resId), newReservation);
        showToast('予約しました！');
      }
    } catch (e) { 
      handleFirestoreError(e, OperationType.WRITE, 'reservations', showToast); 
    }
  };

  // 喫食ステータスの切り替え
  const handleToggleConsumed = async (resId: string, currentState: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', resId), { 
        consumed: !currentState,
        consumedAt: !currentState ? Timestamp.now() : null 
      });
      showToast(!currentState ? '召し上がれ！' : '取り消しました');
    } catch (e) { 
      handleFirestoreError(e, OperationType.UPDATE, 'reservations', showToast); 
    }
  };

  // AI献立解析とバッチ登録
  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!manualApiKey) {
      showToast("先に設定でAPIキーを入力してください", "error");
      return;
    }
    setIsProcessing(true);
    try {
      const result = await extractMenuFromFile(file);
      if (result && result.length > 0) {
        const batch = writeBatch(db);
        result.forEach((item: any) => {
          const newDocRef = doc(collection(db, 'menu'));
          batch.set(newDocRef, { 
            ...item, 
            createdAt: Timestamp.now(),
            createdBy: user?.id 
          });
        });
        await batch.commit();
        showToast(`${result.length}件の献立を一括登録しました`);
      }
    } catch (error) { 
      console.error(error);
      showToast("画像の解析に失敗しました。形式を確認してください。", "error"); 
    } finally { 
      setIsProcessing(false); 
      if (fileInputRef.current) fileInputRef.current.value = ''; 
    }
  };

  // CSVダウンロード機能
  const downloadCSV = () => {
    const headers = "職員名,昼食予約,昼食喫食,夕食予約,夕食喫食\n";
    const rows = monthlyReport.map(r => 
      `${r.name},${r.lunch_count},${r.lunch_consumed},${r.dinner_count},${r.dinner_consumed}`
    ).join("\n");
    const blob = new Blob(["\uFEFF" + headers + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `喫食統計_${reportMonth}.csv`;
    link.click();
  };

  if (!isAuthReady) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-stone-50">
        <Loader2 className="animate-spin text-emerald-600 mb-4" size={56} />
        <p className="font-black text-stone-400 tracking-widest uppercase text-xs">System Initializing...</p>
      </div>
    );
  }

  // ==========================================
  // 5. レンダリング部
  // ==========================================
  return (
    <div className="min-h-screen bg-[#FDFCFB] text-stone-900 font-sans selection:bg-emerald-100">
      
      {/* --- ヘッダー --- */}
      <header className="bg-white/90 backdrop-blur-xl border-b border-stone-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-600 p-2.5 rounded-[1.2rem] text-white shadow-lg shadow-emerald-100/50">
            <UtensilsCrossed size={26} />
          </div>
          <div className="leading-tight">
            <h1 className="font-black text-2xl tracking-tighter">開聞クリニック</h1>
            <p className="text-[10px] font-black text-stone-300 uppercase tracking-[0.2em]">Medical Eating Hub</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <button 
              onClick={() => setIsAdminView(!isAdminView)} 
              className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm transition-all shadow-lg active:scale-95 ${
                isAdminView ? 'bg-emerald-600 text-white shadow-emerald-200' : 'bg-stone-50 text-stone-500 hover:bg-stone-100'
              }`}
            >
              <Settings size={18} />
              <span className="hidden sm:inline">{isAdminView ? '現場画面' : '管理者用'}</span>
            </button>
          )}
          {user && (
            <div className="flex items-center gap-4 ml-2 pl-6 border-l border-stone-100">
              <div className="text-right hidden md:block">
                <p className="text-[10px] font-black text-stone-300 uppercase leading-none mb-1">Signed in as</p>
                <p className="text-sm font-black text-stone-700">{user.name}</p>
              </div>
              <button 
                onClick={() => signOut(auth)} 
                className="p-3 text-stone-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
              >
                <LogOut size={22} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto p-4 md:p-8 lg:p-12">
        {!user ? (
          /* --- ログイン画面 --- */
          <div className="max-w-md mx-auto mt-24 text-center animate-in fade-in zoom-in duration-700">
            <div className="bg-white p-14 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] rounded-[4rem] border border-stone-100 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-3 bg-emerald-600"></div>
              <div className="w-28 h-28 bg-emerald-50 text-emerald-600 rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 shadow-inner">
                <UserIcon size={56} />
              </div>
              <h2 className="text-4xl font-black mb-4 text-stone-800 tracking-tighter">職員ログイン</h2>
              <p className="text-stone-400 mb-12 font-bold leading-relaxed px-4">
                クリニックのアカウントを使用して<br/>システムへアクセスしてください
              </p>
              <button 
                onClick={() => signInWithPopup(auth, new GoogleAuthProvider())} 
                className="w-full py-6 bg-stone-900 text-white rounded-[2rem] flex items-center justify-center gap-5 font-black text-lg shadow-2xl hover:bg-stone-800 hover:-translate-y-1 transition-all active:translate-y-0"
              >
                Googleでログイン
              </button>
            </div>
          </div>
        ) : isAdminView ? (
          /* --- 管理者ダッシュボード (原型ロジック満載) --- */
          <div className="space-y-10 animate-in slide-in-from-right-8 duration-700">
            <div className="flex flex-wrap gap-4 p-2.5 bg-stone-100 rounded-[2.5rem] w-fit mx-auto md:mx-0 shadow-inner border border-stone-200/50">
              {[ 
                {id:'menu', label:'献立管理', icon:Sparkles}, 
                {id:'students', label:'職員名簿', icon:Users}, 
                {id:'report', label:'利用統計', icon:History},
                {id:'settings', label:'設定', icon:Settings}
              ].map((t) => (
                <button 
                  key={t.id} 
                  onClick={() => setAdminTab(t.id as any)} 
                  className={`flex items-center gap-3 px-10 py-4 rounded-[2rem] font-black text-sm transition-all active:scale-95 ${
                    adminTab === t.id ? 'bg-white text-emerald-600 shadow-xl scale-105' : 'text-stone-400 hover:text-stone-600'
                  }`}
                >
                  <t.icon size={20} /> {t.label}
                </button>
              ))}
            </div>

            <div className="bg-white p-10 md:p-16 rounded-[4.5rem] border border-stone-100 shadow-[0_20px_50px_rgba(0,0,0,0.02)] min-h-[700px] relative">
              {adminTab === 'menu' && (
                <div className="space-y-14">
                   <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 border-b border-stone-50 pb-12">
                    <div className="max-w-xl">
                      <h3 className="text-4xl font-black tracking-tight mb-3">献立の一括登録</h3>
                      <p className="text-stone-400 font-bold text-lg leading-relaxed">
                        Gemini AIが献立表の画像を解析し、自動でカレンダー形式に展開します。
                      </p>
                    </div>
                    <label className={`cursor-pointer bg-stone-900 text-white px-12 py-6 rounded-3xl font-black text-xl flex items-center justify-center gap-4 hover:bg-stone-800 transition-all shadow-2xl shadow-stone-200 active:scale-95 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                      {isProcessing ? <Loader2 className="animate-spin" size={24} /> : <Upload size={24} />}
                      画像から解析・登録
                      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,application/pdf" />
                    </label>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                    {menu.length > 0 ? menu.slice().reverse().map(m => (
                      <div key={m.id} className="p-8 bg-stone-50 rounded-[3rem] border border-stone-100 group hover:bg-white hover:shadow-2xl hover:border-emerald-100 transition-all duration-500">
                        <div className="flex justify-between items-start mb-6">
                          <span className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] ${
                            m.meal_type === 'lunch' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'
                          }`}>
                            {m.meal_type}
                          </span>
                          <button 
                            onClick={async () => {
                              if(window.confirm('この献立を削除しますか？')) await deleteDoc(doc(db, 'menu', m.id!));
                            }}
                            className="text-stone-200 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={18}/>
                          </button>
                        </div>
                        <p className="text-xs font-black text-stone-400 mb-2">{m.date}</p>
                        <p className="font-black text-stone-800 text-xl leading-tight">{m.title}</p>
                      </div>
                    )) : (
                      <div className="col-span-full py-40 text-center">
                        <div className="w-24 h-24 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
                          <Sparkles className="text-stone-200" size={48}/>
                        </div>
                        <p className="text-stone-300 font-black text-2xl italic">登録済みの献立はありません</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {adminTab === 'report' && (
                <div className="space-y-12">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                    <div>
                      <h3 className="text-4xl font-black tracking-tight mb-3">利用統計レポート</h3>
                      <p className="text-stone-400 font-bold text-lg">月間集計とCSVエクスポートを行います</p>
                    </div>
                    <div className="flex items-center gap-5 bg-stone-50 p-4 rounded-[2rem] border border-stone-100">
                      <input 
                        type="month" 
                        value={reportMonth} 
                        onChange={(e) => setReportMonth(e.target.value)} 
                        className="bg-white border-none rounded-2xl px-6 py-4 font-black text-stone-700 shadow-sm outline-none focus:ring-2 ring-emerald-500/20" 
                      />
                      <button 
                        onClick={downloadCSV} 
                        className="bg-emerald-600 text-white p-5 rounded-2xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 active:scale-95"
                      >
                        <FileDown size={28} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    {[
                      { label: '総予約数', val: monthlyReport.reduce((acc, r) => acc + r.lunch_count + r.dinner_count, 0), unit: '回' },
                      { label: '昼食喫食率', val: Math.round((monthlyReport.reduce((acc, r) => acc + r.lunch_consumed, 0) / (monthlyReport.reduce((acc, r) => acc + r.lunch_count, 0) || 1)) * 100), unit: '%' },
                      { label: '夕食喫食率', val: Math.round((monthlyReport.reduce((acc, r) => acc + r.dinner_consumed, 0) / (monthlyReport.reduce((acc, r) => acc + r.dinner_count, 0) || 1)) * 100), unit: '%' },
                    ].map((stat, idx) => (
                      <div key={idx} className="bg-stone-50 p-10 rounded-[3rem] border border-stone-100 shadow-inner">
                        <p className="text-[10px] font-black text-stone-400 uppercase tracking-widest mb-4">{stat.label}</p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-5xl font-black text-stone-800">{stat.val}</p>
                          <span className="text-xl font-black text-stone-400">{stat.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-hidden rounded-[3.5rem] border border-stone-100 shadow-xl shadow-stone-100/50">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-stone-50/80 text-stone-400 text-[10px] font-black uppercase tracking-[0.2em]">
                          <th className="py-8 pl-12">職員氏名</th>
                          <th className="py-8 text-center">昼食 (予約/喫食)</th>
                          <th className="py-8 text-center">夕食 (予約/喫食)</th>
                          <th className="py-8 pr-12 text-right">ステータス</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {monthlyReport.map((row) => (
                          <tr key={row.id} className="group hover:bg-emerald-50/20 transition-all">
                            <td className="py-8 pl-12">
                              <p className="font-black text-stone-700 text-xl">{row.name}</p>
                            </td>
                            <td className="py-8 text-center">
                              <div className="flex items-center justify-center gap-3">
                                <span className="text-stone-400 font-bold">{row.lunch_count}</span>
                                <span className="text-stone-200">/</span>
                                <span className="font-black text-emerald-600 bg-emerald-50 px-4 py-1.5 rounded-xl text-lg">{row.lunch_consumed}</span>
                              </div>
                            </td>
                            <td className="py-8 text-center">
                              <div className="flex items-center justify-center gap-3">
                                <span className="text-stone-400 font-bold">{row.dinner_count}</span>
                                <span className="text-stone-200">/</span>
                                <span className="font-black text-indigo-600 bg-indigo-50 px-4 py-1.5 rounded-xl text-lg">{row.dinner_consumed}</span>
                              </div>
                            </td>
                            <td className="py-8 pr-12 text-right">
                              <div className="flex justify-end gap-1.5">
                                {[...Array(5)].map((_, i) => (
                                  <div key={i} className={`w-2 h-2 rounded-full ${
                                    i < (row.lunch_consumed + row.dinner_consumed) / 2 ? 'bg-emerald-400' : 'bg-stone-100'
                                  }`}></div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {adminTab === 'settings' && (
                <div className="max-w-3xl space-y-12">
                  <h3 className="text-4xl font-black tracking-tight mb-4">システム設定</h3>
                  <div className="space-y-8 bg-stone-50 p-12 rounded-[3.5rem] border border-stone-100 shadow-inner">
                    <div className="space-y-4">
                      <label className="block text-[10px] font-black text-stone-400 uppercase tracking-[0.2em]">Gemini AI API Key</label>
                      <input 
                        type="password" 
                        value={manualApiKey} 
                        onChange={(e) => setManualApiKey(e.target.value)}
                        placeholder="APIキーを入力してください"
                        className="w-full bg-white border-2 border-stone-100 rounded-3xl px-8 py-5 font-bold text-lg focus:border-emerald-500 outline-none transition-all shadow-sm"
                      />
                      <div className="flex items-start gap-3 p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 mt-4">
                        <Info className="text-emerald-600 shrink-0" size={20} />
                        <p className="text-xs text-emerald-800 font-bold leading-relaxed">
                          このキーは献立表（画像やPDF）からテキスト情報を読み取るために使用されます。
                          設定されたキーはブラウザに安全に保存され、通信はAIサービスとの間でのみ行われます。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* --- 現場用 2カラム・リアルタイム同期レイアウト --- */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 animate-in slide-in-from-bottom-12 duration-1000">
            
            {/* 左カラム：予約パネル */}
            <div className="space-y-10">
              <section className="bg-white p-10 md:p-14 rounded-[5rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.08)] border border-stone-50 flex flex-col min-h-[650px]">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-14 gap-8">
                  <h3 className="text-4xl font-black flex items-center gap-5 tracking-tighter">
                    <div className="bg-orange-50 text-orange-600 p-4 rounded-[1.5rem] shadow-inner">
                      <CalendarIcon size={32} />
                    </div>
                    献立予約
                  </h3>
                  <div className="flex bg-stone-100/60 p-2 rounded-[2.2rem] self-start border border-stone-200/50 backdrop-blur-md">
                    <button 
                      onClick={() => setSelectedMealType('lunch')} 
                      className={`px-12 py-4 rounded-[1.8rem] text-sm font-black transition-all active:scale-90 ${
                        selectedMealType === 'lunch' ? 'bg-white text-orange-600 shadow-xl scale-105' : 'text-stone-400 hover:text-stone-500'
                      }`}
                    >
                      昼食
                    </button>
                    <button 
                      onClick={() => setSelectedMealType('dinner')} 
                      className={`px-12 py-4 rounded-[1.8rem] text-sm font-black transition-all active:scale-90 ${
                        selectedMealType === 'dinner' ? 'bg-white text-indigo-600 shadow-xl scale-105' : 'text-stone-400 hover:text-stone-500'
                      }`}
                    >
                      夕食
                    </button>
                  </div>
                </div>

                <div className={`flex-1 rounded-[4.5rem] p-12 border-2 flex flex-col transition-all duration-700 ${
                  reservations.some(r => r.date === selectedDate && r.meal_type === selectedMealType) 
                  ? 'bg-emerald-50/40 border-emerald-100 shadow-inner' : 'bg-stone-50 border-stone-100'
                }`}>
                  <div className="relative mb-14 group">
                    <input 
                      type="date" 
                      value={selectedDate} 
                      onChange={(e) => setSelectedDate(e.target.value)} 
                      className="bg-white px-10 py-6 rounded-[2.2rem] font-black text-stone-800 shadow-2xl shadow-stone-200/60 border-none outline-none ring-4 ring-transparent focus:ring-emerald-500/20 transition-all text-xl w-full sm:w-auto" 
                    />
                    <div className="absolute -top-4 -right-4 bg-emerald-600 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                      <CalendarIcon size={20}/>
                    </div>
                  </div>
                  
                  {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType) ? (
                    <div className="flex-1 flex flex-col justify-between space-y-14">
                      <div className="animate-in fade-in slide-in-from-left-6">
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.3em] mb-6 block bg-emerald-100/50 w-fit px-4 py-1 rounded-full">Menu of the day</span>
                        <p className="text-6xl font-black text-stone-800 leading-[1] tracking-tighter">
                          {menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.title}
                        </p>
                      </div>
                      
                      <button 
                        onClick={() => handleToggleReservation(menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)!)}
                        className={`w-full py-12 rounded-[3.5rem] font-black text-4xl transition-all shadow-[0_25px_50px_-12px_rgba(0,0,0,0.1)] active:scale-95 ${
                          reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) 
                          ? 'bg-rose-500 text-white shadow-rose-200 hover:bg-rose-600' : 'bg-emerald-600 text-white shadow-emerald-200 hover:bg-emerald-700'
                        }`}
                      >
                        {reservations.some(r => r.menu_id === menu.find(m => m.date === selectedDate && m.meal_type === selectedMealType)?.id) 
                          ? '予約取消' : '予約を確定'}
                      </button>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-20 animate-pulse">
                      <div className="w-32 h-32 bg-stone-100 rounded-full flex items-center justify-center mb-8 border-4 border-white shadow-inner">
                        <UtensilsCrossed size={64} className="text-stone-200" />
                      </div>
                      <p className="text-stone-300 font-black text-2xl italic tracking-tight">献立が準備中です...</p>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* 右カラム：喫食確認パネル */}
            <div className="space-y-10">
              <section className="bg-white p-10 md:p-14 rounded-[5rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.08)] border border-stone-50 h-full flex flex-col">
                <div className="flex items-center justify-between mb-14">
                  <h3 className="text-4xl font-black flex items-center gap-5 tracking-tighter">
                    <div className="bg-emerald-50 text-emerald-600 p-4 rounded-[1.5rem] shadow-inner">
                      <ClipboardList size={32} />
                    </div>
                    本日の喫食確認
                  </h3>
                  <div className="flex items-center gap-3 bg-emerald-50 px-6 py-3 rounded-full border border-emerald-100 shadow-sm">
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                    <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Real-time sync</span>
                  </div>
                </div>

                <div className="flex-1 space-y-6">
                  {reservations.filter(r => r.date === selectedDate).length > 0 ? (
                    <AnimatePresence mode="popLayout" initial={false}>
                      {reservations.filter(r => r.date === selectedDate).map(res => (
                        <motion.div 
                          key={res.id} 
                          layout 
                          initial={{ opacity: 0, x: 20 }} 
                          animate={{ opacity: 1, x: 0 }} 
                          exit={{ opacity: 0, scale: 0.9 }}
                          className={`flex items-center justify-between p-10 rounded-[3.5rem] border-2 transition-all group ${
                            res.consumed ? 'bg-emerald-50/60 border-emerald-100 shadow-inner' : 'bg-stone-50 border-stone-200/60'
                          }`}
                        >
                          <div className="space-y-2">
                            <div className="flex items-center gap-4">
                              <span className={`w-4 h-4 rounded-full shadow-sm ${
                                res.meal_type === 'lunch' ? 'bg-orange-400' : 'bg-indigo-400'
                              }`}></span>
                              <p className="font-black text-stone-800 text-3xl tracking-tighter">{res.title}</p>
                            </div>
                            <div className="flex items-center gap-3 pl-8">
                              <p className="text-[10px] font-black text-stone-300 uppercase tracking-widest leading-none">
                                {res.meal_type} / {res.user_name}
                              </p>
                              {res.consumed && (
                                <span className="flex items-center gap-1 text-emerald-600 text-[10px] font-black">
                                  <Check size={12}/> OK
                                </span>
                              )}
                            </div>
                          </div>
                          <button 
                            onClick={() => handleToggleConsumed(res.id, res.consumed)}
                            className={`relative px-14 py-7 rounded-[2.2rem] font-black text-xl transition-all shadow-xl active:scale-90 ${
                              res.consumed 
                              ? 'bg-emerald-600 text-white shadow-emerald-200' 
                              : 'bg-white text-emerald-600 border-2 border-emerald-600 hover:bg-emerald-600 hover:text-white'
                            }`}
                          >
                            <span className="flex items-center gap-3">
                              {res.consumed ? <CheckCircle2 size={28} /> : null}
                              {res.consumed ? '完了' : '確認'}
                            </span>
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center py-40 opacity-20">
                      <div className="w-32 h-32 bg-stone-50 rounded-full flex items-center justify-center mb-8 border-4 border-white shadow-inner">
                        <FileText size={64} className="text-stone-300" />
                      </div>
                      <p className="text-stone-400 font-black text-2xl tracking-tight leading-relaxed">
                        本日の予約データは<br/>まだ入っていません
                      </p>
                    </div>
                  )}
                </div>
                
                <div className="mt-14 p-10 bg-stone-50/80 rounded-[3.5rem] border border-stone-100 backdrop-blur-sm">
                  <div className="flex items-start gap-4">
                    <Info className="text-emerald-600 shrink-0 mt-1" size={24} />
                    <div>
                      <p className="text-[10px] font-black text-stone-400 uppercase tracking-[0.2em] mb-2">Clinic Information</p>
                      <p className="text-sm font-bold text-stone-600 leading-relaxed italic">
                        喫食の確認は、お食事が終わったタイミングで必ず行ってください。<br/>
                        集計されたデータは翌月の栄養管理の貴重な資料となります。
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* --- トースト通知 --- */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 100, scale: 0.8 }} 
            animate={{ opacity: 1, y: 0, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.8 }} 
            className="fixed bottom-12 left-4 right-4 md:left-auto md:right-12 md:w-[450px] z-[100]"
          >
            <div className={`p-10 rounded-[3rem] shadow-[0_40px_100px_rgba(0,0,0,0.2)] flex items-center gap-6 border border-white/20 backdrop-blur-2xl ${
              toast.type === 'error' ? 'bg-rose-500/95 text-white shadow-rose-200' : 'bg-stone-900/95 text-white shadow-stone-600'
            }`}>
              <div className="bg-white/20 p-3 rounded-2xl">
                {toast.type === 'error' ? <XCircle size={32}/> : <CheckCircle2 size={32}/>}
              </div>
              <div>
                <p className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-1">Notification</p>
                <p className="font-black text-xl tracking-tight">{toast.message}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
