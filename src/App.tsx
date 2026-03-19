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

// --- Error Handling Spec for Firestore Permissions ---
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
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
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
        providerId: provider.providerId,
        displayName: provider.displayName || '',
        email: provider.email || '',
        photoUrl: provider.photoURL || ''
      })) || []
    },
    operationType,
    path
  };
  
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  if (toastFn) {
    if (errInfo.error.includes('permission-denied') || errInfo.error.includes('insufficient permissions')) {
      toastFn("権限がありません。管理者としてログインしているか確認してください。", "error");
    } else if (errInfo.error.includes('Failed to fetch') || errInfo.error.includes('network-error') || errInfo.error.includes('unavailable')) {
      toastFn("サーバーとの通信に失敗しました。インターネット接続やFirebaseの設定を確認してください。", "error");
    } else if (errInfo.error.includes('quota') || errInfo.error.includes('exceeded')) {
      toastFn("利用制限（クォータ）に達しました。明日までお待ちください。", "error");
    } else {
      toastFn(`エラーが発生しました: ${errInfo.error.substring(0, 100)}`, "error");
    }
  }
}

// --- Error Boundary Component ---
class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if ((this as any).state.hasError) {
      let errorMessage = "予期せぬエラーが発生しました。";
      try {
        const parsed: FirestoreErrorInfo = JSON.parse((this as any).state.error?.message || '{}');
        if (parsed.error && parsed.operationType) {
          errorMessage = `データベースエラー: ${parsed.error} (${parsed.operationType})`;
        }
      } catch (e) {
        errorMessage = (this as any).state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
          <div className="glass-card p-8 max-w-md w-full text-center">
            <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-stone-800 mb-2">エラーが発生しました</h1>
            <p className="text-stone-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all"
            >
              アプリを再読み込みする
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getMenuImageUrl = (title: string, description: string) => {
  const combined = (title + ' ' + (description || '')).toLowerCase();
  let keyword = 'lunch';

  if (combined.includes('カレー') || combined.includes('curry')) keyword = 'curry';
  else if (combined.includes('鯖') || combined.includes('さば') || combined.includes('mackerel')) keyword = 'mackerel';
  else if (combined.includes('鶏') || combined.includes('チキン') || combined.includes('chicken')) keyword = 'chicken';
  else if (combined.includes('パスタ') || combined.includes('スパゲッティ') || combined.includes('pasta')) keyword = 'pasta';
  else if (combined.includes('寿司') || combined.includes('sushi')) keyword = 'sushi';
  else if (combined.includes('ハンバーグ') || combined.includes('hamburg')) keyword = 'hamburg';
  else if (combined.includes('唐揚げ') || combined.includes('karaage')) keyword = 'friedchicken';
  else if (combined.includes('うどん') || combined.includes('udon')) keyword = 'udon';
  else if (combined.includes('そば') || combined.includes('soba')) keyword = 'soba';
  else if (combined.includes('ラーメン') || combined.includes('ramen')) keyword = 'ramen';
  else if (combined.includes('野菜') || combined.includes('vegetable')) keyword = 'vegetables';
  else if (combined.includes('肉') || combined.includes('meat')) keyword = 'meat';
  else if (combined.includes('魚') || combined.includes('fish')) keyword = 'fish';
  else if (combined.includes('和食') || combined.includes('japanese')) keyword = 'japanesefood';

  return `https://loremflickr.com/800/600/food,lunch,${keyword}`;
};

// Safe localStorage helper
const safeStorage = {
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.error("Storage error:", e);
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error("Storage error:", e);
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error("Storage error:", e);
    }
  }
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
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginId, setLoginId] = useState("");
  const [loginError, setLoginError] = useState("");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(formatDate(new Date()));
  const [selectedMealType, setSelectedMealType] = useState<'lunch' | 'dinner'>('lunch');
  const [advice, setAdvice] = useState<string>("");
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [pendingMenus, setPendingMenus] = useState<Partial<MenuItem>[]>([]);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuCsvInputRef = useRef<HTMLInputElement>(null);
  const menuDetailRef = useRef<HTMLDivElement>(null);
  const lastClickTimeRef = useRef<{ [key: string]: number }>({});

  // --- Firebase Auth & Firestore Sync ---
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Check if user exists in Firestore
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data() as User;
            setUser(userData);
            setIsAdminView(userData.role === 'admin');
          } else {
            // New user from Google Login - default to student
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
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setUser(null);
        setIsAdminView(false);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribeAuth();
  }, []);

  // --- Real-time Data Sync ---
  useEffect(() => {
    if (!isAuthReady) return;

    // Menu is public
    const qMenu = query(collection(db, 'menu'), orderBy('date', 'asc'));
    const unsubscribeMenu = onSnapshot(qMenu, (snapshot) => {
      const menuData = snapshot.docs.map(doc => doc.data() as MenuItem);
      setMenu(menuData);
      
      // Auto-select today or next available menu
      const today = formatDate(new Date());
      const nextMenu = menuData.find(m => m.date >= today);
      if (nextMenu && !selectedDate) {
        setSelectedDate(nextMenu.date);
        const dayMenus = menuData.filter(m => m.date === nextMenu.date);
        const hasLunch = dayMenus.some(m => m.meal_type === 'lunch');
        setSelectedMealType(hasLunch ? 'lunch' : 'dinner');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'menu');
    });

    // Reservations (filtered by user if not admin)
    let qRes;
    if (user?.role === 'admin') {
      qRes = query(collection(db, 'reservations'));
    } else if (user) {
      qRes = query(collection(db, 'reservations'), where('user_id', '==', user.id));
    }

    let unsubscribeRes = () => {};
    if (qRes) {
      unsubscribeRes = onSnapshot(qRes, (snapshot) => {
        const resData = snapshot.docs.map(doc => doc.data() as Reservation);
        setReservations(resData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'reservations');
      });
    }

    return () => {
      unsubscribeMenu();
      unsubscribeRes();
    };
  }, [isAuthReady, user?.id, user?.role]);

  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // Profile creation/loading is handled by onAuthStateChanged listener
    } catch (error) {
      console.error("Google Login Error:", error);
      showToast("ログインに失敗しました", "error");
    }
  };
  
  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedId = loginId.trim();
    if (!trimmedId) {
      setLoginError("職員IDを入力してください");
      return;
    }

    setLoginError("");
    setIsLoggingIn(true);
    try {
      // Find user by username in Firestore
      const q = query(collection(db, 'users'), where('username', '==', trimmedId), limit(1));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const userData = querySnapshot.docs[0].data() as User;
        
        // If we are already logged in via Google, and trying to switch to a staff ID,
        // we should warn that Firestore writes might fail if the IDs don't match.
        if (auth.currentUser && auth.currentUser.uid !== userData.id) {
          showToast("Googleログイン中ですが、別の職員IDでログインします。一部の機能が制限される場合があります。", "info" as any);
        }
        
        setUser(userData);
        setIsAdminView(userData.role === 'admin');
        showToast(`${userData.name}さん、こんにちは！`);
      } else {
        setLoginError("職員IDが見つかりません。管理者に登録を依頼するか、下の「システムを初期化」をお試しください。");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('network') || errorMsg.includes('unavailable')) {
        setLoginError("通信エラーが発生しました。インターネット接続を確認してください。");
      } else {
        setLoginError("ログイン中にエラーが発生しました。職員IDが正しいか確認してください。");
      }
      handleFirestoreError(err, OperationType.LIST, 'users', showToast);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setIsAdminView(false);
      setLoginId("");
      setReservations([]);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  useEffect(() => {
    if (user) {
      setIsAdminView(user.role === 'admin');
    } else {
      setIsAdminView(false);
    }
  }, [user?.id]);

  const selectedMenus = Array.isArray(menu) ? menu.filter(m => m && m.date === selectedDate) : [];
  const currentMenu = selectedMenus.find(m => m && m.meal_type === selectedMealType);

  useEffect(() => {
    if (currentMenu) {
      setLoadingAdvice(true);
      getMenuAdvice(currentMenu.title, currentMenu.description).then(res => {
        setAdvice(res || "");
        setLoadingAdvice(false);
      });
    } else {
      setAdvice("");
    }
  }, [selectedDate, selectedMealType, !!currentMenu]);

  const isReserved = (menuId: string) => 
    Array.isArray(reservations) && reservations.some(r => r && r.menu_id === menuId && r.user_id === user?.id);

  const toggleReservation = async (menuId: string) => {
    if (!user) {
      showToast('予約するにはログインしてください', 'error');
      return;
    }

    const currentlyReserved = reservations.some(r => r.menu_id === menuId && r.user_id === user.id);
    const resId = `${user.id}_${menuId}`;

    try {
      if (currentlyReserved) {
        await deleteDoc(doc(db, 'reservations', resId));
        showToast('予約をキャンセルしました');
      } else {
        const targetMenu = menu.find(m => m.id === menuId);
        const newRes: Reservation = {
          id: resId,
          user_id: user.id,
          menu_id: menuId,
          status: 'reserved',
          consumed: false,
          date: targetMenu?.date,
          title: targetMenu?.title,
          meal_type: targetMenu?.meal_type
        };
        await setDoc(doc(db, 'reservations', resId), newRes);
        showToast('予約を完了しました！');
      }
    } catch (error) {
      const errStr = error instanceof Error ? error.message : String(error);
      if (errStr.includes('permission-denied') && !auth.currentUser) {
        showToast('セッションが切れています。一度ログアウトして再度ログインしてください。', 'error');
      } else {
        handleFirestoreError(error, OperationType.WRITE, `reservations/${resId}`, showToast);
      }
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Array(new Date(year, month, 1).getDay()).fill(null);
    const lastDay = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= lastDay; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const [viewDate, setViewDate] = useState(new Date());
  const [adminStats, setAdminStats] = useState<any[]>([]);
  const [monthlyReport, setMonthlyReport] = useState<any[]>([]);
  const [dailyChecklist, setDailyChecklist] = useState<any[]>([]);
  const [checklistDate, setChecklistDate] = useState(formatDate(new Date()));
  const [reportMonth, setReportMonth] = useState(formatDate(new Date()).slice(0, 7));
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminTab, setAdminTab] = useState<'menu' | 'students' | 'report'>('menu');
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [isSelfCheckMode, setIsSelfCheckMode] = useState(false);
  const [selfCheckSearch, setSelfCheckSearch] = useState('');
  const [selfCheckMealFilter, setSelfCheckMealFilter] = useState<'all' | 'lunch' | 'dinner'>('all');
  const [guestName, setGuestName] = useState('');
  const [isReservingGuest, setIsReservingGuest] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', name: '', role: 'student' as 'student' | 'admin' });
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const userFileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ 
    isOpen: boolean, 
    title: string, 
    message: string, 
    confirmText?: string,
    cancelText?: string,
    showInput?: boolean,
    inputValue?: string,
    isTesting?: boolean,
    onConfirm: (val?: string) => void 
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const [manualApiKey, setManualApiKey] = useState<string>(() => safeStorage.getItem('manual_gemini_api_key') || '');

  useEffect(() => {
    // Always sync the manual key to the window object for the service to pick up
    // @ts-ignore
    window._manual_api_key = manualApiKey;
    if (manualApiKey) {
      safeStorage.setItem('manual_gemini_api_key', manualApiKey);
    } else {
      safeStorage.removeItem('manual_gemini_api_key');
    }
  }, [manualApiKey]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [newMenu, setNewMenu] = useState({
    date: formatDate(new Date()),
    meal_type: 'lunch' as 'lunch' | 'dinner',
    title: '',
    description: '',
    calories: 600,
    allergens: ''
  });

  useEffect(() => {
    if (isAdminView) {
      const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
        const usersData = snapshot.docs.map(doc => doc.data() as User);
        setAdminUsers(usersData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
      return () => unsubscribeUsers();
    }
  }, [isAdminView]);

  useEffect(() => {
    if (isAdminView && menu.length > 0) {
      // Compute stats
      const stats = menu.map(m => {
        const menuRes = reservations.filter(r => r.menu_id === m.id);
        const names = menuRes.map(r => r.user_id ? (adminUsers.find(u => u.id === r.user_id)?.name || r.user_id) : `ゲスト: ${r.guest_name}`).join(", ");
        return { ...m, count: menuRes.length, names };
      });
      setAdminStats(stats);

      // Compute monthly report
      const students = adminUsers.filter(u => u.role === 'student');
      const monthMenus = menu.filter(m => m.date.startsWith(reportMonth));
      const monthMenuIds = monthMenus.map(m => m.id);

      const report = students.map(u => {
        const userRes = reservations.filter(r => r.user_id === u.id && monthMenuIds.includes(r.menu_id));
        
        let lunch_count = 0, lunch_consumed = 0, dinner_count = 0, dinner_consumed = 0;
        
        userRes.forEach(r => {
          const m = monthMenus.find(item => item.id === r.menu_id);
          if (m) {
            if (m.meal_type === 'lunch') {
              lunch_count++;
              if (r.consumed) lunch_consumed++;
            } else if (m.meal_type === 'dinner') {
              dinner_count++;
              if (r.consumed) dinner_consumed++;
            }
          }
        });

        return {
          name: u.name,
          username: u.username,
          lunch_count,
          lunch_consumed,
          dinner_count,
          dinner_consumed,
          total_count: lunch_count + dinner_count,
          total_consumed: lunch_consumed + dinner_consumed
        };
      });
      setMonthlyReport(report);
    }
  }, [isAdminView, menu, reservations, adminUsers, reportMonth]);

  useEffect(() => {
    if (isAdminView && checklistDate) {
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
    }
  }, [isAdminView, menu, reservations, adminUsers, checklistDate]);

  const handleGuestReservation = async (menuId: string) => {
    if (!guestName.trim()) {
      showToast('お名前を入力してください', 'error');
      return;
    }

    setIsReservingGuest(true);
    const resId = `guest_${Date.now()}`;
    try {
      const targetMenu = menu.find(m => m.id === menuId);
      const newRes: Reservation = {
        id: resId,
        menu_id: menuId,
        guest_name: guestName,
        status: 'reserved',
        consumed: false,
        date: targetMenu?.date,
        title: targetMenu?.title,
        meal_type: targetMenu?.meal_type
      };
      await setDoc(doc(db, 'reservations', resId), newRes);
      showToast('予約が完了しました！');
      setGuestName('');
      setIsGuestMode(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `reservations/${resId}`);
    } finally {
      setIsReservingGuest(false);
    }
  };

  const toggleConsumed = async (reservationId: string, currentStatus: boolean) => {
    try {
      await updateDoc(doc(db, 'reservations', reservationId), {
        consumed: !currentStatus
      });
      if (!currentStatus) {
        showToast('喫食を確認しました。召し上がれ！');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `reservations/${reservationId}`);
    }
  };

  const handleAddUser = async (e: FormEvent) => {
    e.preventDefault();
    const userId = `user_${Date.now()}`;
    try {
      const userToSave = { ...newUser, id: userId };
      await setDoc(doc(db, 'users', userId), userToSave);
      setNewUser({ username: '', name: '', role: 'student' });
      showToast('職員を登録しました！');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${userId}`);
    }
  };

  const handleUpdateUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await setDoc(doc(db, 'users', editingUser.id), editingUser);
      setEditingUser(null);
      showToast('職員情報を更新しました！');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${editingUser.id}`);
    }
  };

  const handleUserImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    
    reader.onload = async (event) => {
      try {
        let users = [];
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length === 0) return;
        
        // Skip header if it exists
        const startIdx = (lines[0] && (lines[0].includes('名前') || lines[0].includes('ID'))) ? 1 : 0;
        
        for (let i = startIdx; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(',').map(s => s.trim());
          if (parts.length >= 2) {
            const [name, username, role] = parts;
            if (name && username) {
              users.push({ 
                name, 
                username, 
                role: (role === '管理者' || role === 'admin') ? 'admin' : 'student' 
              });
            }
          }
        }

        if (users.length === 0) {
          showToast('有効なデータが見つかりませんでした。', 'error');
          setIsImporting(false);
          if (userFileInputRef.current) userFileInputRef.current.value = '';
          return;
        }

        const batch = writeBatch(db);
        users.forEach(u => {
          const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const userRef = doc(db, 'users', userId);
          batch.set(userRef, { id: userId, ...u });
        });
        await batch.commit();
        showToast(`${users.length} 名の職員をインポートしました！`);
      } catch (error) {
        console.error(error);
        showToast('ファイルの読み込みに失敗しました。', 'error');
      } finally {
        setIsImporting(false);
        if (userFileInputRef.current) userFileInputRef.current.value = '';
      }
    };

    reader.readAsText(file);
  };

  const handleDeleteUser = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: '職員の削除',
      message: 'この職員を削除してもよろしいですか？予約データも削除されます。',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'users', id));
          // Also delete their reservations
          const q = query(collection(db, 'reservations'), where('user_id', '==', id));
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          showToast('職員を削除しました。');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${id}`);
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteMenu = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: '献立の削除',
      message: 'この日の献立を削除してもよろしいですか？予約データも削除されます。',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'menu', id));
          // Also delete reservations for this menu
          const q = query(collection(db, 'reservations'), where('menu_id', '==', id));
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          showToast('献立を削除しました。');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `menu/${id}`);
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const exportMonthlyReport = () => {
    if (!monthlyReport || monthlyReport.length === 0) {
      showToast('データがありません', 'error');
      return;
    }

    let csv = "\uFEFF"; // BOM for Excel
    csv += "名前,ユーザーID,昼食(予約),昼食(喫食),夕食(予約),夕食(喫食),合計(予約),合計(喫食)\n";
    monthlyReport.forEach(row => {
      csv += `"${row.name}","${row.username}",${row.lunch_count},${row.lunch_consumed},${row.dinner_count},${row.dinner_consumed},${row.total_count},${row.total_consumed}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `monthly_report_${reportMonth}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportDailyChecklist = () => {
    if (!dailyChecklist || dailyChecklist.length === 0) {
      showToast('データがありません', 'error');
      return;
    }

    let csv = "\uFEFF"; // BOM for Excel
    csv += "名前,ユーザーID,食事タイプ,状態\n";
    dailyChecklist.forEach(row => {
      const mealType = row.meal_type === 'dinner' ? '夕食' : '昼食';
      const status = row.consumed ? '食事済' : '未完了';
      csv += `"${row.name}","${row.username}","${mealType}","${status}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `daily_checklist_${checklistDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check for API key before starting
    const hasApiKey = manualApiKey || (process.env as any).GEMINI_API_KEY;
    if (!hasApiKey) {
      showToast('AI解析にはAPIキーの設定が必要です。右上の設定アイコンから設定してください。', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Support PDF and common image formats
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      showToast('PDFまたは画像ファイルを選択してください', 'error');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      showToast('ファイルサイズが大きすぎます（20MB以下にしてください）。', 'error');
      return;
    }

    setIsScanning(true);
    console.log("File upload started:", file.name, file.type, file.size);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const result = event.target?.result as string;
          if (!result) throw new Error("ファイルの読み込み結果が空です。");
          const base64 = result.split(',')[1];
          
          // Use the Gemini service to extract menu
          const extracted = await extractMenuFromFile(base64, file.type);
          
          if (extracted.length === 0) {
            showToast('献立を抽出できませんでした。ファイルの内容を確認してください。', 'error');
            setIsScanning(false);
            return;
          }

          const sorted = [...extracted].sort((a, b) => {
            if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
            return (b.meal_type || '').localeCompare(a.meal_type || '');
          });
          
          setPendingMenus(sorted);
          showToast(`${sorted.length}件の献立を読み込みました。内容を確認して保存してください。`);
          setIsScanning(false);
        } catch (error: any) {
          console.error("Extraction error:", error);
          showToast(error.message || '解析に失敗しました。', 'error');
          setIsScanning(false);
        }
      };
      reader.onerror = () => {
        showToast('ファイルの読み込み中にエラーが発生しました。', 'error');
        setIsScanning(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("File reader error:", error);
      showToast('ファイルの読み込みに失敗しました。', 'error');
      setIsScanning(false);
    }
  };


  const updatePendingMenu = (index: number, field: keyof MenuItem, value: any) => {
    const updated = [...pendingMenus];
    updated[index] = { ...updated[index], [field]: value };
    setPendingMenus(updated);
  };

  const removePendingMenu = (index: number) => {
    setPendingMenus(pendingMenus.filter((_, i) => i !== index));
  };

  const handleMenuCsvImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split(/\r?\n/);
        const newMenus: Partial<MenuItem>[] = [];

        // Skip header
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Handle CSV with potential commas in quotes
          const parts: string[] = [];
          let currentPart = '';
          let inQuotes = false;
          for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              parts.push(currentPart.trim());
              currentPart = '';
            } else {
              currentPart += char;
            }
          }
          parts.push(currentPart.trim());

          if (parts.length >= 3) {
            // Convert date format if needed (e.g., 2026/03/17 -> 2026-03-17)
            let dateStr = parts[0].replace(/\//g, '-');
            // Basic validation for date format
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
              console.warn(`Invalid date format: ${dateStr}`);
              continue;
            }

            newMenus.push({
              date: dateStr,
              meal_type: (parts[1] && (parts[1].includes('夕食') || parts[1].includes('dinner'))) ? 'dinner' : 'lunch',
              title: parts[2] || '名称未設定',
              description: parts[3] || '',
              calories: parseInt(parts[4]) || 600,
              allergens: parts[5] || ''
            });
          }
        }

        if (newMenus.length > 0) {
          const sorted = [...newMenus].sort((a, b) => {
            if (a.date !== b.date) return (a.date || '').localeCompare(b.date || '');
            return (b.meal_type || '').localeCompare(a.meal_type || '');
          });
          setPendingMenus(sorted);
          showToast(`${sorted.length} 件の献立を読み込みました。内容を確認して保存してください。`);
        } else {
          showToast('有効な献立データが見つかりませんでした。形式を確認してください。', 'error');
        }
      } catch (err) {
        console.error("CSV Import Error:", err);
        showToast('ファイルの読み込み中にエラーが発生しました。', 'error');
      }
      if (menuCsvInputRef.current) menuCsvInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const savePendingMenus = async () => {
    if (pendingMenus.length === 0) return;
    
    if (!isAdminView) {
      showToast('管理者権限が必要です。', 'error');
      return;
    }

    try {
      const batch = writeBatch(db);
      pendingMenus.forEach(m => {
        if (!m.date || !m.title) return; // Skip invalid entries
        const id = `${m.date}_${m.meal_type || 'lunch'}`;
        const menuRef = doc(db, 'menu', id);
        batch.set(menuRef, { id, ...m });
      });
      await batch.commit();
      showToast(`${pendingMenus.length} 件の献立を登録・更新しました！`);
      setPendingMenus([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'menu', showToast);
    }
  };

  const handleAddMenu = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdminView) {
      showToast('管理者権限が必要です。', 'error');
      return;
    }
    const id = `${newMenu.date}_${newMenu.meal_type}`;
    try {
      await setDoc(doc(db, 'menu', id), { id, ...newMenu });
      setNewMenu({
        date: formatDate(new Date()),
        meal_type: 'lunch',
        title: '',
        description: '',
        calories: 600,
        allergens: ''
      });
      showToast('献立を登録しました！');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `menu/${id}`, showToast);
    }
  };

  const switchUser = async (username: string) => {
    try {
      const q = query(collection(db, 'users'), where('username', '==', username), limit(1));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const userData = snapshot.docs[0].data() as User;
        setUser(userData);
        setIsAdminView(userData.role === 'admin');
        showToast(`${userData.name}に切り替えました`);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'users');
    }
  };

  const calendarDays = getDaysInMonth(viewDate);

  if (!user) {
    return (
      <div className="min-h-screen bg-[#fdfbf7] flex items-center justify-center p-6" translate="no">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-8 w-full max-w-md space-y-8"
        >
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 mx-auto mb-4">
              <UtensilsCrossed size={32} />
            </div>
            <h1 className="text-2xl font-bold text-stone-800 tracking-tight">みんなのごはん</h1>
            <p className="text-sm text-stone-500">
              {isSelfCheckMode ? 'お名前を探してチェックしてください' : isGuestMode ? 'お名前を入力して予約してください' : '職員IDを入力してログインしてください'}
            </p>
          </div>

          {isSelfCheckMode ? (
            <div className="space-y-6">
              {/* Today's Menu Info */}
              {Array.isArray(menu) && menu.filter(m => m && m.date === formatDate(new Date())).length > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-5 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 bg-emerald-600 rounded-lg flex items-center justify-center text-white shadow-sm">
                      <UtensilsCrossed size={14} />
                    </div>
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">本日の献立</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {Array.isArray(menu) && menu.filter(m => m && m.date === formatDate(new Date())).map(m => (
                      <div key={m.id} className="flex items-center justify-between bg-white/50 p-3 rounded-2xl border border-emerald-100/50">
                        <div className="flex items-center gap-3">
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${m.meal_type === 'dinner' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {m.meal_type === 'dinner' ? '夕食' : '昼食'}
                          </span>
                          <p className="text-sm font-bold text-stone-800 leading-tight">{m.title}</p>
                        </div>
                        <p className="text-[10px] font-bold text-stone-400">{m.calories} kcal</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input 
                      type="text" 
                      placeholder="名前で検索..."
                      value={selfCheckSearch}
                      onChange={e => setSelfCheckSearch(e.target.value)}
                      className="w-full p-5 pl-14 bg-white border-2 border-stone-100 rounded-3xl text-base focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-sm"
                    />
                    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-stone-400">
                      <Search size={24} />
                    </div>
                  </div>
                  <div className="flex bg-stone-100 p-1 rounded-2xl">
                    <button 
                      onClick={() => setSelfCheckMealFilter('all')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${selfCheckMealFilter === 'all' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                    >
                      すべて
                    </button>
                    <button 
                      onClick={() => setSelfCheckMealFilter('lunch')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${selfCheckMealFilter === 'lunch' ? 'bg-white text-emerald-600 shadow-sm' : 'text-stone-500'}`}
                    >
                      昼食
                    </button>
                    <button 
                      onClick={() => setSelfCheckMealFilter('dinner')}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${selfCheckMealFilter === 'dinner' ? 'bg-white text-indigo-600 shadow-sm' : 'text-stone-500'}`}
                    >
                      夕食
                    </button>
                  </div>
                </div>

                <div className="space-y-0 border border-stone-200 rounded-3xl overflow-hidden bg-white shadow-sm max-h-[400px] overflow-y-auto custom-scrollbar">
                  {Array.isArray(dailyChecklist) && dailyChecklist
                    .filter(row => {
                      if (!row) return false;
                      const matchesSearch = row.name.toLowerCase().includes(selfCheckSearch.toLowerCase());
                      const matchesMeal = selfCheckMealFilter === 'all' || row.meal_type === selfCheckMealFilter;
                      return matchesSearch && matchesMeal;
                    })
                    .map((row, idx, arr) => (
                      <div 
                        key={row.id} 
                        onClick={() => toggleConsumed(row.id, row.consumed)}
                        className={`p-5 transition-all cursor-pointer flex items-center justify-between group ${idx !== arr.length - 1 ? 'border-b border-stone-100' : ''} ${row.consumed ? 'bg-emerald-50/30' : 'hover:bg-stone-50'}`}
                      >
                        <div className="flex items-center gap-5">
                          <div className={`w-10 h-10 rounded-2xl border-2 flex items-center justify-center transition-all ${row.consumed ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-stone-300 bg-white group-hover:border-emerald-400'}`}>
                            {row.consumed ? <Check size={24} strokeWidth={3} /> : <div className="w-2 h-2 bg-stone-200 rounded-full" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className={`text-lg font-bold transition-all ${row.consumed ? 'text-stone-400 line-through' : 'text-stone-800'}`}>{row.name}</p>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${row.meal_type === 'dinner' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                {row.meal_type === 'dinner' ? '夕食' : '昼食'}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-stone-400 uppercase tracking-tight">{row.username === 'GUEST' ? 'ゲスト' : `ID: ${row.username}`}</p>
                          </div>
                        </div>
                        {row.consumed ? (
                          <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-3 py-1.5 rounded-xl">喫食済み</span>
                        ) : (
                          <span className="text-xs font-bold text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity">タップしてチェック</span>
                        )}
                      </div>
                    ))}
                  {dailyChecklist.length === 0 && (
                    <div className="text-center py-16 text-stone-400">
                      <Info size={32} className="mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-medium">本日の予約はありません</p>
                    </div>
                  )}
                </div>
              </div>

              <button 
                onClick={() => setIsSelfCheckMode(false)}
                className="w-full py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold text-sm hover:bg-stone-200 transition-all"
              >
                ログイン画面に戻る
              </button>
            </div>
          ) : isGuestMode ? (
            <div className="space-y-6">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">お名前</label>
                <input 
                  type="text" 
                  placeholder="例: 山田 太郎"
                  value={guestName}
                  onChange={e => setGuestName(e.target.value)}
                  className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">予約日を選択</label>
                <select 
                  key={`guest-select-${Array.isArray(menu) ? menu.length : 0}`}
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                >
                  <option value="">日付を選択してください</option>
                  {Array.isArray(menu) && menu.filter(m => m && m.date >= formatDate(new Date())).map(m => (
                    <option key={m.id} value={m.date}>{m.date} - {m.title}</option>
                  ))}
                </select>
                {(!Array.isArray(menu) || menu.filter(m => m && m.date >= formatDate(new Date())).length === 0) && (
                  <p className="text-[10px] text-red-500 font-bold mt-1">現在、予約可能な献立がありません。</p>
                )}
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsGuestMode(false)}
                  className="flex-1 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold text-sm hover:bg-stone-200 transition-all"
                >
                  キャンセル
                </button>
                <button 
                  onClick={() => {
                    const m = Array.isArray(menu) ? menu.find(item => item && item.date === selectedDate) : null;
                    if (m) handleGuestReservation(m.id);
                    else showToast('日付を選択してください', 'error');
                  }}
                  disabled={isReservingGuest}
                  className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2"
                >
                  {isReservingGuest && <Loader2 className="animate-spin" size={18} />}
                  予約を確定する
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleGoogleLogin}
                  className="w-full py-4 bg-white border-2 border-stone-100 text-stone-700 rounded-2xl font-bold text-sm hover:bg-stone-50 transition-all flex items-center justify-center gap-3 shadow-sm"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                  Googleでログイン
                </button>

                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-stone-100"></div>
                  <span className="flex-shrink mx-4 text-[10px] font-bold text-stone-300 uppercase tracking-widest">または</span>
                  <div className="flex-grow border-t border-stone-100"></div>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">職員ID</label>
                    <input 
                      type="text" 
                      required
                      placeholder="例: staff1"
                      value={loginId}
                      onChange={e => {
                        setLoginId(e.target.value);
                        if (loginError) setLoginError("");
                      }}
                      className="w-full p-4 bg-stone-50 border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                  </div>
                  {loginError && (
                    <p className="text-xs font-bold text-red-500 flex items-center gap-1 bg-red-50 p-3 rounded-2xl border border-red-100">
                      <XCircle size={14} className="shrink-0" />
                      {loginError}
                    </p>
                  )}
                  <button 
                    type="submit"
                    disabled={isLoggingIn}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                  >
                    {isLoggingIn && <Loader2 className="animate-spin" size={18} />}
                    ログイン
                  </button>
                </form>
              </div>

              <div className="flex flex-col gap-3 mt-6">
                <button 
                  onClick={() => {
                    setSelfCheckSearch("");
                    setIsSelfCheckMode(true);
                    setChecklistDate(formatDate(new Date()));
                  }}
                  className="w-full py-4 bg-stone-800 text-white rounded-2xl font-bold text-base hover:bg-stone-900 shadow-xl shadow-stone-200 transition-all flex items-center justify-center gap-3"
                >
                  <CheckCircle2 size={22} />
                  喫食チェックを開始する
                </button>

                <button 
                  onClick={() => {
                    setIsGuestMode(true);
                    const today = formatDate(new Date());
                    const nextMenu = Array.isArray(menu) ? menu.find(m => m && m.date >= today) : null;
                    if (nextMenu) {
                      setSelectedDate(nextMenu.date);
                      const dayMenus = Array.isArray(menu) ? menu.filter(m => m && m.date === nextMenu.date) : [];
                      const hasLunch = dayMenus.some(m => m && m.meal_type === 'lunch');
                      setSelectedMealType(hasLunch ? 'lunch' : 'dinner');
                    }
                  }}
                  className="w-full py-3 border-2 border-emerald-600 text-emerald-600 rounded-2xl font-bold text-sm hover:bg-emerald-50 transition-all"
                >
                  未登録の方はこちら（ゲスト予約）
                </button>
                
                <div className="pt-6 border-t border-stone-100">
                  <p className="text-[10px] font-bold text-stone-400 uppercase text-center mb-3">デモ用アカウント</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setLoginId('staff1')} className="p-2 text-[10px] font-bold bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-all">職員 (staff1)</button>
                    <button onClick={() => setLoginId('admin')} className="p-2 text-[10px] font-bold bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-all">栄養科 (admin)</button>
                  </div>
                  <button 
                    onClick={() => {
                      setConfirmModal({
                        isOpen: true,
                        title: 'システム初期化',
                        message: 'システムをリセット（初期化）しますか？\n※全てのデータが削除され、初期データが作成されます。\n※初期化にはGoogleログイン（管理者）が必要です。',
                        confirmText: '初期化する',
                        cancelText: 'キャンセル',
                        onConfirm: async () => {
                          // Check if user is admin via app state OR via firebase auth directly (for bootstrap)
                          const isAuthAdmin = auth.currentUser?.email === 'satukikawaji@gmail.com';
                          const isAppAdmin = user?.role === 'admin';

                          if (!isAuthAdmin && !isAppAdmin) {
                            showToast("初期化には管理者権限が必要です。Googleでログインしてください。", "error");
                            setConfirmModal(prev => ({ ...prev, isOpen: false }));
                            return;
                          }

                          try {
                            const batch = writeBatch(db);
                            
                            // Seed Users
                            const users = [
                              { id: 'admin1', username: 'admin', name: '管理者', role: 'admin' },
                              { id: 'staff1', username: 'staff1', name: '佐藤 健', role: 'student' },
                              { id: 'staff2', username: 'staff2', name: '田中 美咲', role: 'student' },
                              { id: 'staff3', username: 'staff3', name: '鈴木 一郎', role: 'student' },
                            ];
                            users.forEach(u => batch.set(doc(db, 'users', u.id), u));

                            // Seed Menu
                            const today = new Date();
                            for (let i = 0; i < 14; i++) {
                              const d = new Date(today);
                              d.setDate(today.getDate() + i);
                              const ds = formatDate(d);
                              
                              const lunchId = `${ds}_lunch`;
                              batch.set(doc(db, 'menu', lunchId), {
                                id: lunchId,
                                date: ds,
                                meal_type: 'lunch',
                                title: i % 2 === 0 ? '鶏の照り焼き定食' : '鯖の味噌煮定食',
                                description: i % 2 === 0 ? 'ジューシーな鶏肉を特製タレで。' : '脂の乗った鯖を濃厚な味噌で。',
                                calories: 650,
                                allergens: '小麦, 大豆'
                              });

                              const dinnerId = `${ds}_dinner`;
                              batch.set(doc(db, 'menu', dinnerId), {
                                id: dinnerId,
                                date: ds,
                                meal_type: 'dinner',
                                title: i % 2 === 0 ? 'ハンバーグステーキ' : '海鮮ちらし寿司',
                                description: i % 2 === 0 ? 'ふっくら焼き上げた手作りハンバーグ。' : '新鮮な海の幸をふんだんに。',
                                calories: 750,
                                allergens: '卵, 小麦, 乳'
                              });
                            }
                            
                            await batch.commit();
                            showToast("システムを初期化しました。");
                            setConfirmModal(prev => ({ ...prev, isOpen: false }));
                          } catch (error) {
                            handleFirestoreError(error, OperationType.WRITE, 'seed', showToast);
                          }
                        }
                      });
                    }}
                    className="w-full mt-4 p-2 text-[8px] font-bold text-stone-300 hover:text-stone-500 transition-all uppercase tracking-widest"
                  >
                    システムを初期化する (管理者用)
                  </button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfbf7] pb-20" translate="no">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/70 backdrop-blur-lg border-b border-stone-200 px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
            <UtensilsCrossed size={18} className="sm:hidden" />
            <UtensilsCrossed size={20} className="hidden sm:block" />
          </div>
          <h1 className="text-base sm:text-xl font-bold tracking-tight text-stone-800">みんなのごはん</h1>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          {user?.role === 'admin' && (
            <button 
              onClick={() => {
                setSelfCheckSearch("");
                setChecklistDate(formatDate(new Date()));
                setIsSelfCheckMode(true);
                setUser(null);
                setLoginId("");
              }}
              className="hidden md:flex px-4 py-2 bg-stone-800 text-white rounded-xl font-bold text-xs hover:bg-stone-900 transition-all items-center gap-2"
            >
              <CheckCircle2 size={16} />
              喫食チェックモードへ
            </button>
          )}
          <div className="text-right">
            <p className="text-xs sm:text-sm font-bold text-stone-900 leading-tight">{user?.name}</p>
            <p className="text-[9px] sm:text-xs text-stone-500 capitalize leading-tight">{user?.role === 'admin' ? '栄養科' : '職員'}</p>
          </div>
          <button 
            onClick={handleLogout}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-stone-100 hover:bg-red-50 hover:text-red-600 rounded-full flex items-center justify-center text-stone-600 border border-stone-200 transition-all"
            title="ログアウト"
          >
            <LogOut size={18} className="sm:hidden" />
            <LogOut size={20} className="hidden sm:block" />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-2 sm:px-6 py-4 sm:py-8 grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        {/* Left Column: Calendar or Admin Stats */}
        <div className="lg:col-span-7 space-y-6">
          {user?.role === 'admin' ? (
            <div className="space-y-6">
              {/* Admin Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex gap-2 bg-stone-100 p-1 rounded-2xl w-fit">
                  <button 
                    onClick={() => setAdminTab('menu')}
                    className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${adminTab === 'menu' ? 'bg-white shadow-sm text-emerald-600' : 'text-stone-500'}`}
                  >
                    献立管理
                  </button>
                  <button 
                    onClick={() => setAdminTab('students')}
                    className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${adminTab === 'students' ? 'bg-white shadow-sm text-emerald-600' : 'text-stone-500'}`}
                  >
                    職員管理
                  </button>
                  <button 
                    onClick={() => setAdminTab('report')}
                    className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${adminTab === 'report' ? 'bg-white shadow-sm text-emerald-600' : 'text-stone-500'}`}
                  >
                    集計レポート
                  </button>
                </div>

                <button 
                  onClick={() => {
                    const canUseStudio = !!(window as any).aistudio?.openSelectKey;
                    setConfirmModal({
                      isOpen: true,
                      title: 'APIキーの設定',
                      message: 'Gemini APIキーを入力してください。このキーはブラウザに保存されます。' + 
                               (canUseStudio ? '\n\nまたは、下の「AI Studioから選択」ボタンを使用して、設定済みのキーを選択することもできます。' : '') +
                               '\n\n入力後、右下の緑色の「保存」ボタンを押してください。',
                      confirmText: '保存',
                      cancelText: 'キャンセル',
                      showInput: true,
                      inputValue: manualApiKey,
                      onConfirm: async (val) => {
                        if (val) {
                          setManualApiKey(val.trim());
                          showToast("APIキーを保存しました。");
                        }
                        setConfirmModal(prev => ({ ...prev, isOpen: false }));
                      }
                    });
                  }}
                  className="flex items-center gap-2 px-4 py-2 text-stone-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl text-xs font-bold transition-all"
                >
                  <Settings size={14} />
                  APIキー設定
                </button>
              </div>

              {adminTab === 'menu' ? (
                <>
                  {/* Add Menu Form */}
                  <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-bold flex items-center gap-2">
                        <UtensilsCrossed size={20} className="text-emerald-600" />
                        献立を登録
                      </h2>
                      <p className="text-[10px] text-stone-400 mt-1">
                        ※「AIスキャン」は画像からメニューを読み取るための機能です。GoogleのAIを使用するためAPIキーが必要ですが、手動で入力する場合は不要です。
                      </p>
                    </div>
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col sm:flex-row items-center gap-4">
                        <input 
                          type="file" 
                          ref={fileInputRef}
                          onChange={handleFileUpload}
                          className="hidden"
                          accept="image/*,application/pdf"
                        />
                        <button 
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isScanning}
                          className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all disabled:opacity-50"
                        >
                          {isScanning ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                          PDFまたは画像から献立を読み込む
                        </button>

                        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                          <input 
                            type="file" 
                            ref={menuCsvInputRef}
                            onChange={handleMenuCsvImport}
                            accept=".csv"
                            className="hidden"
                          />
                          <button 
                            onClick={() => menuCsvInputRef.current?.click()}
                            className="w-full sm:w-auto flex items-center justify-center gap-3 px-6 py-4 bg-stone-100 text-stone-600 rounded-2xl font-bold text-sm hover:bg-stone-200 transition-all"
                          >
                            <FileText size={18} />
                            CSVからインポート
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              const csv = "\uFEFF日付(YYYY-MM-DD),区分(昼食/夕食),メニュー名,詳細説明,エネルギー(kcal),アレルゲン\n2026-04-01,昼食,日替わり定食,サバの味噌煮と小鉢のセット,650,サバ・大豆\n2026-04-01,夕食,カレーライス,スパイスの効いた特製カレー,780,小麦・乳";
                              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                              const link = document.createElement("a");
                              link.href = URL.createObjectURL(blob);
                              link.setAttribute("download", "menu_template.csv");
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            }}
                            className="text-[10px] font-bold text-stone-400 hover:text-stone-600 px-2 py-1 transition-all"
                          >
                            テンプレート
                          </button>
                        </div>
                        <p className="text-[11px] text-stone-400">
                          ※ 献立表のPDFや写真をアップロードするだけで、AIが自動的にメニューを抽出します。
                        </p>
                      </div>
                    </div>
                      <p className="text-[10px] text-stone-400 mt-3 px-1">
                        ※ PDFや大きな画像は解析に30秒〜1分ほどかかる場合があります。
                      </p>
                    
                    {pendingMenus.length > 0 ? (
                      <div className="space-y-4">
                        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                          <p className="text-xs font-bold text-emerald-700 mb-3 flex items-center gap-2">
                            <FileText size={14} />
                            AIが {pendingMenus.length} 件の献立を読み取りました
                          </p>
                          <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
                            {pendingMenus.map((m, i) => (
                              <div key={i} className="bg-white p-4 rounded-xl border border-emerald-100 space-y-3">
                                <div className="flex justify-between items-start gap-2">
                                  <div className="grid grid-cols-3 gap-2 flex-1">
                                    <input 
                                      type="date" 
                                      value={m.date}
                                      onChange={e => updatePendingMenu(i, 'date', e.target.value)}
                                      className="p-2 bg-stone-50 border border-stone-100 rounded-lg text-[10px] font-bold outline-none focus:ring-1 focus:ring-emerald-500"
                                    />
                                    <select
                                      value={m.meal_type}
                                      onChange={e => updatePendingMenu(i, 'meal_type', e.target.value)}
                                      className="p-2 bg-stone-50 border border-stone-100 rounded-lg text-[10px] font-bold outline-none focus:ring-1 focus:ring-emerald-500"
                                    >
                                      <option value="lunch">昼食</option>
                                      <option value="dinner">夕食</option>
                                    </select>
                                    <input 
                                      type="text" 
                                      value={m.title}
                                      onChange={e => updatePendingMenu(i, 'title', e.target.value)}
                                      className="p-2 bg-stone-50 border border-stone-100 rounded-lg text-[10px] font-bold outline-none focus:ring-1 focus:ring-emerald-500"
                                    />
                                  </div>
                                  <button 
                                    onClick={() => removePendingMenu(i)}
                                    className="p-2 text-stone-300 hover:text-red-500 transition-all"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                                <textarea 
                                  value={m.description}
                                  onChange={e => updatePendingMenu(i, 'description', e.target.value)}
                                  className="w-full p-2 bg-stone-50 border border-stone-100 rounded-lg text-[10px] outline-none focus:ring-1 focus:ring-emerald-500 h-16 resize-none"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="flex items-center gap-2 bg-stone-50 border border-stone-100 rounded-lg px-2">
                                    <span className="text-[8px] font-bold text-stone-400 uppercase">kcal</span>
                                    <input 
                                      type="number" 
                                      value={m.calories}
                                      onChange={e => updatePendingMenu(i, 'calories', parseInt(e.target.value))}
                                      className="w-full p-1 bg-transparent text-[10px] font-bold outline-none"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2 bg-stone-50 border border-stone-100 rounded-lg px-2">
                                    <span className="text-[8px] font-bold text-stone-400 uppercase">アレルゲン</span>
                                    <input 
                                      type="text" 
                                      value={m.allergens}
                                      onChange={e => updatePendingMenu(i, 'allergens', e.target.value)}
                                      className="w-full p-1 bg-transparent text-[10px] font-bold outline-none"
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={savePendingMenus}
                            className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all"
                          >
                            これらをすべて登録する
                          </button>
                          <button 
                            onClick={() => setPendingMenus([])}
                            className="px-6 py-3 bg-stone-100 text-stone-500 rounded-xl font-bold text-sm hover:bg-stone-200 transition-all"
                          >
                            破棄
                          </button>
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handleAddMenu} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">日付</label>
                          <input 
                            type="date" 
                            required
                            value={newMenu.date}
                            onChange={e => setNewMenu({...newMenu, date: e.target.value})}
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">区分</label>
                          <select 
                            value={newMenu.meal_type}
                            onChange={e => setNewMenu({...newMenu, meal_type: e.target.value as 'lunch' | 'dinner'})}
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          >
                            <option value="lunch">昼食 (ランチ)</option>
                            <option value="dinner">夕食 (夜勤用)</option>
                          </select>
                        </div>
                        <div className="sm:col-span-2 space-y-1">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">メニュー名</label>
                          <input 
                            type="text" 
                            required
                            placeholder="例: 日替わりランチ"
                            value={newMenu.title}
                            onChange={e => setNewMenu({...newMenu, title: e.target.value})}
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="sm:col-span-2 space-y-1">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">詳細説明</label>
                          <textarea 
                            required
                            placeholder="メニューの内容やこだわりを入力してください"
                            value={newMenu.description}
                            onChange={e => setNewMenu({...newMenu, description: e.target.value})}
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none h-24 resize-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">エネルギー (kcal)</label>
                          <input 
                            type="number" 
                            required
                            value={newMenu.calories}
                            onChange={e => setNewMenu({...newMenu, calories: parseInt(e.target.value)})}
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">アレルゲン</label>
                          <input 
                            type="text" 
                            placeholder="例: 卵、乳、小麦"
                            value={newMenu.allergens}
                            onChange={e => setNewMenu({...newMenu, allergens: e.target.value})}
                            className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <div className="sm:col-span-2 flex gap-2">
                          <button 
                            type="submit"
                            className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all"
                          >
                            献立を登録・更新する
                          </button>
                          <button 
                            type="button"
                            onClick={() => setNewMenu({
                              date: formatDate(new Date()),
                              meal_type: 'lunch',
                              title: '',
                              description: '',
                              calories: 600,
                              allergens: ''
                            })}
                            className="px-6 py-4 bg-stone-100 text-stone-500 rounded-2xl font-bold text-sm hover:bg-stone-200 transition-all"
                          >
                            クリア
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="glass-card p-6">
                    <h2 className="text-lg font-bold flex items-center gap-2 mb-6">
                      <ClipboardList size={20} className="text-emerald-600" />
                      日別予約状況
                    </h2>
                    <div className="space-y-4">
                      {Array.isArray(adminStats) && adminStats.map(stat => (
                        <div key={`${stat.date}-${stat.meal_type}-${stat.id}`} className="p-4 bg-stone-50 rounded-2xl border border-stone-100 group">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3 flex-1">
                              <div className="w-12 h-12 rounded-xl overflow-hidden bg-white border border-stone-200 flex-shrink-0">
                                <img 
                                  src={getMenuImageUrl(stat.title, stat.description)} 
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  alt={stat.title}
                                />
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-xs font-bold text-stone-400">{stat.date}</p>
                                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${stat.meal_type === 'dinner' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    {stat.meal_type === 'dinner' ? '夕食' : '昼食'}
                                  </span>
                                </div>
                                <p className="text-sm font-bold text-stone-800">{stat.title}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-2xl font-bold text-emerald-600">{stat.count}</p>
                                <p className="text-[10px] font-bold text-stone-400 uppercase">予約数</p>
                              </div>
                              <button 
                                onClick={() => {
                                  setNewMenu({
                                    date: stat.date,
                                    meal_type: stat.meal_type || 'lunch',
                                    title: stat.title,
                                    description: stat.description || '',
                                    calories: stat.calories || 600,
                                    allergens: stat.allergens || ''
                                  });
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className="p-2 text-stone-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                title="献立を編集"
                              >
                                <Pencil size={16} />
                              </button>
                              <button 
                                onClick={() => handleDeleteMenu(stat.id)}
                                className="p-2 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                title="献立を削除"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                          {stat.names && (
                            <div className="pt-2 border-t border-stone-200">
                              <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">予約者一覧</p>
                              <p className="text-xs text-stone-600">{stat.names}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : adminTab === 'students' ? (
                <div className="space-y-6">
                  {/* Add/Edit Student Form */}
                  <div className="glass-card p-6">
                    <h2 className="text-lg font-bold flex items-center gap-2 mb-6">
                      <UserIcon size={20} className="text-emerald-600" />
                      {editingUser ? '職員情報を編集' : '職員を登録'}
                    </h2>
                    <form onSubmit={editingUser ? handleUpdateUser : handleAddUser} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-stone-400 uppercase">名前</label>
                        <input 
                          type="text" 
                          required
                          placeholder="例: 山田 花子"
                          value={editingUser ? editingUser.name : newUser.name}
                          onChange={e => editingUser ? setEditingUser({...editingUser, name: e.target.value}) : setNewUser({...newUser, name: e.target.value})}
                          className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-stone-400 uppercase">職員ID (ログイン用)</label>
                        <input 
                          type="text" 
                          required
                          placeholder="例: staff123"
                          value={editingUser ? editingUser.username : newUser.username}
                          onChange={e => editingUser ? setEditingUser({...editingUser, username: e.target.value}) : setNewUser({...newUser, username: e.target.value})}
                          className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-stone-400 uppercase">権限</label>
                        <select 
                          value={editingUser ? editingUser.role : newUser.role}
                          onChange={e => editingUser ? setEditingUser({...editingUser, role: e.target.value as any}) : setNewUser({...newUser, role: e.target.value as any})}
                          className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        >
                          <option value="student">職員 (一般)</option>
                          <option value="admin">管理者</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2 flex gap-2">
                        <button 
                          type="submit"
                          className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all"
                        >
                          {editingUser ? '更新する' : '職員を登録する'}
                        </button>
                        {editingUser && (
                          <button 
                            type="button"
                            onClick={() => setEditingUser(null)}
                            className="px-6 py-4 bg-stone-100 text-stone-500 rounded-2xl font-bold text-sm hover:bg-stone-200 transition-all"
                          >
                            キャンセル
                          </button>
                        )}
                      </div>
                      {!editingUser && (
                        <div className="sm:col-span-2 pt-4 border-t border-stone-100 flex flex-col sm:flex-row gap-2">
                          <input 
                            type="file" 
                            ref={userFileInputRef}
                            onChange={handleUserImport}
                            accept=".csv"
                            className="hidden"
                          />
                          <button 
                            type="button"
                            onClick={() => userFileInputRef.current?.click()}
                            disabled={isImporting}
                            className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-2xl font-bold text-sm hover:bg-stone-200 transition-all flex items-center justify-center gap-2"
                          >
                            {isImporting ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                            CSVから一括インポート
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              const csv = "\uFEFF名前,職員ID,権限(管理者/職員)\n山田 太郎,staff101,職員\n佐藤 美咲,staff102,管理者";
                              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                              const link = document.createElement("a");
                              link.href = URL.createObjectURL(blob);
                              link.setAttribute("download", "staff_template.csv");
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            }}
                            className="px-6 py-3 text-stone-400 hover:text-stone-600 text-xs font-bold transition-all"
                          >
                            テンプレートをダウンロード
                          </button>
                        </div>
                      )}
                    </form>
                  </div>

                  {/* Student List */}
                  <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-bold flex items-center gap-2">
                        <ClipboardList size={20} className="text-emerald-600" />
                        登録済み職員一覧
                      </h2>
                      {adminUsers.length > 1 && (
                        <button 
                          onClick={() => {
                            setConfirmModal({
                              isOpen: true,
                              title: '全職員データの削除',
                              message: '自分以外のすべての職員データを削除しますか？この操作は取り消せません。',
                              onConfirm: async () => {
                                try {
                                  const q = query(collection(db, 'users'));
                                  const snapshot = await getDocs(q);
                                  const batch = writeBatch(db);
                                  snapshot.docs.forEach(d => {
                                    if (d.id !== user?.id) {
                                      batch.delete(d.ref);
                                    }
                                  });
                                  await batch.commit();
                                  showToast('自分以外の職員データを削除しました。');
                                } catch (error) {
                                  handleFirestoreError(error, OperationType.DELETE, 'users');
                                }
                                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                              }
                            });
                          }}
                          className="text-xs text-red-500 hover:text-red-700 font-bold flex items-center gap-1 transition-colors"
                        >
                          <Trash2 size={14} />
                          自分以外をすべて削除
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Array.isArray(adminUsers) && adminUsers.map(u => (
                        <div key={u.id} className="p-4 bg-stone-50 rounded-2xl border border-stone-100 flex items-center justify-between gap-3 min-w-0">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 bg-white rounded-full flex-shrink-0 flex items-center justify-center text-stone-400 border border-stone-200">
                              <UserIcon size={18} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-stone-800 truncate">{u.name}</p>
                                {u.role === 'admin' && (
                                  <span className="flex-shrink-0 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-bold rounded uppercase">管理者</span>
                                )}
                              </div>
                              <p className="text-[10px] font-bold text-stone-400 uppercase truncate">ID: {u.username}</p>
                            </div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button 
                              onClick={() => setEditingUser(u)}
                              className="p-2 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                              title="編集"
                            >
                              <Pencil size={16} />
                            </button>
                            <button 
                              onClick={() => handleDeleteUser(u.id)}
                              className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                              title="削除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Daily Checklist */}
                    <div className="glass-card p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                          <CheckCircle2 size={20} className="text-emerald-600" />
                          日別チェック表
                        </h2>
                        <div className="flex items-center gap-4">
                          <input 
                            type="date" 
                            value={checklistDate}
                            onChange={e => setChecklistDate(e.target.value)}
                            className="p-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                          <button 
                            onClick={exportDailyChecklist}
                            className="p-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl transition-all"
                            title="CSVエクスポート"
                          >
                            <Upload size={14} className="rotate-180" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                        {Array.isArray(dailyChecklist) && dailyChecklist.length > 0 ? (
                          dailyChecklist.map(row => (
                            <div 
                              key={row.id} 
                              onClick={() => toggleConsumed(row.id, row.consumed)}
                              className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${row.consumed ? 'bg-emerald-50 border-emerald-100' : 'bg-stone-50 border-stone-100 hover:border-stone-200'}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${row.consumed ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-stone-300 bg-white'}`}>
                                  {row.consumed && <CheckCircle2 size={14} />}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className={`text-sm font-bold ${row.consumed ? 'text-emerald-900' : 'text-stone-800'}`}>{row.name}</p>
                                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${row.meal_type === 'dinner' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                      {row.meal_type === 'dinner' ? '夕食' : '昼食'}
                                    </span>
                                  </div>
                                  <p className="text-[10px] font-bold text-stone-400 uppercase">ID: {row.username}</p>
                                </div>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${row.consumed ? 'bg-emerald-200 text-emerald-700' : 'bg-stone-200 text-stone-500'}`}>
                                {row.consumed ? '食事済' : '未完了'}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="text-center py-12 text-stone-400">
                            <Info size={32} className="mx-auto mb-2 opacity-20" />
                            <p className="text-sm">この日の予約はありません</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Monthly Report */}
                    <div className="glass-card p-6">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                          <h2 className="text-lg font-bold flex items-center gap-2">
                            <ClipboardList size={20} className="text-emerald-600" />
                            月間集計レポート
                          </h2>
                          <input 
                            type="month" 
                            value={reportMonth}
                            onChange={e => setReportMonth(e.target.value)}
                            className="p-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                          />
                        </div>
                        <button 
                          onClick={exportMonthlyReport}
                          className="flex items-center gap-2 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold transition-all"
                        >
                          <Upload size={14} className="rotate-180" />
                          CSVエクスポート
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-stone-200">
                              <th className="pb-3 text-[10px] font-bold text-stone-400 uppercase">名前</th>
                              <th className="pb-3 text-[10px] font-bold text-stone-400 uppercase text-right">昼食(予/喫)</th>
                              <th className="pb-3 text-[10px] font-bold text-stone-400 uppercase text-right">夕食(予/喫)</th>
                              <th className="pb-3 text-[10px] font-bold text-stone-400 uppercase text-right">合計(予/喫)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {Array.isArray(monthlyReport) && monthlyReport.map(row => (
                              <tr key={row.username}>
                                <td className="py-4">
                                  <p className="text-sm font-bold text-stone-800">{row.name}</p>
                                  <p className="text-[10px] text-stone-400">{row.username}</p>
                                </td>
                                <td className="py-4 text-xs font-bold text-stone-600 text-right">
                                  {row.lunch_count} / <span className="text-emerald-600">{row.lunch_consumed}</span>
                                </td>
                                <td className="py-4 text-xs font-bold text-stone-600 text-right">
                                  {row.dinner_count} / <span className="text-emerald-600">{row.dinner_consumed}</span>
                                </td>
                                <td className="py-4 text-sm font-bold text-stone-800 text-right">
                                  {row.total_count} / <span className="text-emerald-600">{row.total_consumed}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <CalendarIcon size={20} className="text-emerald-600" />
                    献立カレンダー
                  </h2>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setViewMode('calendar')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${viewMode === 'calendar' ? 'bg-white shadow-sm text-emerald-600' : 'text-stone-500'}`}
                      >
                        カレンダー
                      </button>
                      <button 
                        onClick={() => setViewMode('list')}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-emerald-600' : 'text-stone-500'}`}
                      >
                        リスト
                      </button>
                    </div>
                    {viewMode === 'calendar' && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() - 1)))}
                          className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <span className="font-bold min-w-[100px] text-center">
                          {viewDate.getFullYear()}年 {viewDate.getMonth() + 1}月
                        </span>
                        <button 
                          onClick={() => setViewDate(new Date(viewDate.setMonth(viewDate.getMonth() + 1)))}
                          className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
                        >
                          <ChevronRight size={20} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {viewMode === 'calendar' ? (
                  <div key="calendar-grid" className="grid grid-cols-7 gap-1 sm:gap-2">
                    {['日', '月', '火', '水', '木', '金', '土'].map(d => (
                      <div key={d} className="text-center text-[11px] sm:text-sm font-bold text-stone-400 py-1">{d}</div>
                    ))}
                    {calendarDays.map((day, i) => {
                      if (!day) return <div key={`empty-${i}`} />;
                      const dateStr = formatDate(day);
                      const dayMenus = Array.isArray(menu) ? menu.filter(m => m && m.date === dateStr) : [];
                      const hasMenu = dayMenus.length > 0;
                      const isSelected = selectedDate === dateStr;
                      const reserved = Array.isArray(reservations) && reservations.some(r => r && r.user_id === user?.id && dayMenus.some(m => m.id === r.menu_id));

                      return (
                        <button
                          key={dateStr}
                          onClick={() => {
                            const now = Date.now();
                            const lastClick = lastClickTimeRef.current[dateStr] || 0;
                            const diff = now - lastClick;
                            lastClickTimeRef.current[dateStr] = now;

                            if (diff < 300 && diff > 50) {
                              // Double tap detected
                              if (dayMenus.length > 0 && user?.role !== 'admin') {
                                const targetMenu = dayMenus.find(m => m.meal_type === 'lunch') || dayMenus[0];
                                if (targetMenu) {
                                  toggleReservation(targetMenu.id);
                                }
                              }
                            } else {
                              // Single tap logic
                              setSelectedDate(dateStr);
                              if (dayMenus.length > 0) {
                                const hasLunch = dayMenus.some(m => m && m.meal_type === 'lunch');
                                setSelectedMealType(hasLunch ? 'lunch' : 'dinner');
                              }
                            }
                          }}
                          className={`
                            relative min-h-[110px] sm:min-h-[130px] p-1.5 rounded-xl flex flex-col items-center justify-start transition-all border
                            ${isSelected ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-200 z-10' : hasMenu ? 'bg-white text-stone-700 border-emerald-100 hover:border-emerald-300 shadow-sm' : 'bg-stone-50/50 text-stone-300 border-transparent'}
                            ${(!hasMenu && user?.role !== 'admin') ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                          `}
                          disabled={!hasMenu && user?.role !== 'admin'}
                        >
                          <span className={`text-[14px] sm:text-lg font-bold mb-1 ${isSelected ? 'text-white' : hasMenu ? 'text-stone-800' : 'text-stone-400'}`}>
                            {day.getDate()}
                          </span>
                          
                          {hasMenu && (
                            <div className="w-full flex flex-col gap-1 mt-auto overflow-hidden">
                              {dayMenus.slice(0, 1).map(m => (
                                <div 
                                  key={m.id} 
                                  className={`
                                    text-[11px] sm:text-[13px] leading-tight line-clamp-3 w-full px-1 py-1.5 rounded text-center font-bold
                                    ${isSelected ? 'bg-white/30 text-white' : 'bg-emerald-100/80 text-emerald-900'}
                                  `}
                                >
                                  {m.title}
                                </div>
                              ))}
                              {dayMenus.length > 1 && (
                                <div className={`text-[9px] sm:text-[11px] text-center font-bold ${isSelected ? 'text-white/80' : 'text-emerald-600'}`}>
                                  他 {dayMenus.length - 1}件
                                </div>
                              )}
                            </div>
                          )}

                          {reserved && (
                            <div className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-emerald-500'}`} />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div key="list-grid" className="space-y-3">
                    {(Array.isArray(menu) ? menu.filter(m => m && m.date >= formatDate(new Date())) : []).map(m => {
                      const isRes = isReserved(m.id);
                      const isSelected = selectedDate === m.date && selectedMealType === m.meal_type;
                      
                      return (
                        <button
                          key={m.id}
                          onClick={() => {
                            const now = Date.now();
                            const lastClick = lastClickTimeRef.current[m.id] || 0;
                            const diff = now - lastClick;
                            lastClickTimeRef.current[m.id] = now;

                            if (diff < 300 && diff > 50) {
                              // Double tap detected
                              if (user?.role !== 'admin') {
                                toggleReservation(m.id);
                              }
                            } else {
                              // Single tap logic
                              setSelectedDate(m.date);
                              setSelectedMealType(m.meal_type);
                            }
                          }}
                          className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all ${isSelected ? 'bg-emerald-50 border-emerald-300 ring-1 ring-emerald-300' : 'bg-white border-stone-200 shadow-sm hover:bg-stone-50'}`}
                        >
                          <div className="flex items-center gap-4 text-left overflow-hidden">
                            <div className="w-14 h-14 rounded-xl overflow-hidden bg-stone-100 flex-shrink-0 border border-stone-100">
                              <img 
                                src={getMenuImageUrl(m.title, m.description)} 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                alt={m.title}
                              />
                            </div>
                            <div className="overflow-hidden">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[11px] font-bold text-stone-400">{m.date}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${m.meal_type === 'dinner' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {m.meal_type === 'dinner' ? '夕食' : '昼食'}
                                </span>
                              </div>
                              <h3 className="text-base font-bold text-stone-800 truncate">{m.title}</h3>
                              <p className="text-xs text-stone-500 truncate">{m.calories} kcal / {m.allergens || 'なし'}</p>
                            </div>
                          </div>
                          <div className="flex-shrink-0 ml-2">
                            {isRes ? (
                              <div className="flex flex-col items-center gap-1 text-emerald-600">
                                <CheckCircle2 size={24} />
                                <span className="text-[10px] font-bold">予約済</span>
                              </div>
                            ) : (
                              <div className="w-10 h-10 bg-stone-50 border border-stone-200 rounded-full flex items-center justify-center text-stone-300">
                                <div className="w-2 h-2 rounded-full bg-stone-300" />
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Reservation Summary & History */}
              <div className="glass-card p-6">
                <h2 className="text-lg font-bold flex items-center gap-2 mb-4">
                  <History size={20} className="text-emerald-600" />
                  予約・喫食履歴
                </h2>
                <div className="space-y-3">
                  {!Array.isArray(reservations) || reservations.length === 0 ? (
                    <p className="text-sm text-stone-500 italic">記録されている給食はありません。</p>
                  ) : (
                    (Array.isArray(reservations) ? reservations.filter(r => r && r.date) : [])
                      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                      .map(res => {
                        const isPast = res.date < formatDate(new Date());
                        const isToday = res.date === formatDate(new Date());
                        
                        return (
                          <div 
                            key={res.id} 
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                              res.consumed 
                                ? 'bg-emerald-50 border-emerald-100' 
                                : isPast 
                                  ? 'bg-stone-50 border-stone-100 opacity-60' 
                                  : 'bg-white border-stone-200 shadow-sm'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-[10px] font-bold text-stone-400">{res.date} {isToday && <span className="text-emerald-600 ml-1">本日</span>}</p>
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${res.meal_type === 'dinner' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {res.meal_type === 'dinner' ? '夕食' : '昼食'}
                                </span>
                              </div>
                              <p className="text-sm font-bold text-stone-800">{res.title}</p>
                            </div>
                            <div className={`flex items-center gap-2 ${
                              res.consumed 
                                ? 'text-emerald-600' 
                                : isPast 
                                  ? 'text-stone-400' 
                                  : 'text-emerald-600'
                            }`}>
                              {res.consumed ? (
                                <>
                                  <CheckCircle2 size={16} />
                                  <span className="text-xs font-bold">喫食済み</span>
                                </>
                              ) : isPast ? (
                                <>
                                  <XCircle size={16} />
                                  <span className="text-xs font-bold">未喫食</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 size={16} />
                                  <span className="text-xs font-bold">予約済み</span>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right Column: Menu Detail */}
        <div ref={menuDetailRef} className="lg:col-span-5">
          <AnimatePresence mode="wait">
            {selectedMenus.length > 0 ? (
              <div key={`menu-detail-${selectedDate}`} className="space-y-6 sticky top-24">
                {/* Meal Type Tabs - Always show if at least one menu exists */}
                <div className="flex p-1 bg-stone-100 rounded-xl">
                  <button
                    onClick={() => setSelectedMealType('lunch')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${selectedMealType === 'lunch' ? 'bg-white text-emerald-600 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                  >
                    昼食 (ランチ)
                    {!selectedMenus.some(m => m.meal_type === 'lunch') && <span className="text-[8px] opacity-50">(未登録)</span>}
                  </button>
                  <button
                    onClick={() => setSelectedMealType('dinner')}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${selectedMealType === 'dinner' ? 'bg-white text-indigo-600 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}
                  >
                    夕食 (夜勤用)
                    {!selectedMenus.some(m => m.meal_type === 'dinner') && <span className="text-[8px] opacity-50">(未登録)</span>}
                  </button>
                </div>

                {currentMenu ? (
                  <div key={`menu-card-${currentMenu.id}`} className="glass-card overflow-hidden">
                    <div className="h-48 bg-stone-200 relative">
                      <img 
                        src={getMenuImageUrl(currentMenu.title, currentMenu.description)} 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        alt={currentMenu.title}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-6">
                        <div className="text-white">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-xs font-bold opacity-80">{currentMenu.date}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${currentMenu.meal_type === 'dinner' ? 'bg-indigo-500/80' : 'bg-emerald-500/80'}`}>
                              {currentMenu.meal_type === 'dinner' ? '夕食' : '昼食'}
                            </span>
                          </div>
                          <h3 className="text-2xl font-bold">{currentMenu.title}</h3>
                        </div>
                      </div>
                    </div>

                    <div className="p-6 space-y-6">
                      <div className="flex gap-4">
                        <div className="flex-1 p-3 bg-stone-50 rounded-2xl border border-stone-100 text-center">
                          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">エネルギー</p>
                          <p className="text-lg font-bold text-stone-800">{currentMenu.calories} <span className="text-xs font-normal">kcal</span></p>
                        </div>
                        <div className="flex-1 p-3 bg-stone-50 rounded-2xl border border-stone-100 text-center">
                          <p className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">アレルゲン</p>
                          <p className="text-xs font-bold text-stone-800 truncate px-1">{currentMenu.allergens || 'なし'}</p>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-stone-800 mb-2">メニュー詳細</h4>
                        <p className="text-sm text-stone-600 leading-relaxed">
                          {currentMenu.description}
                        </p>
                      </div>

                      <button
                        onClick={() => toggleReservation(currentMenu.id)}
                        className={`
                          w-full py-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2
                          ${isReserved(currentMenu.id) 
                            ? 'bg-stone-100 text-stone-500 hover:bg-red-50 hover:text-red-600 border border-stone-200' 
                            : 'bg-emerald-600 text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700'}
                        `}
                      >
                        {isReserved(currentMenu.id) ? (
                          <div key="btn-reserved" className="flex items-center gap-2">
                            <XCircle size={20} />
                            <span>予約をキャンセルする</span>
                          </div>
                        ) : (
                          <div key="btn-not-reserved" className="flex items-center gap-2">
                            <CheckCircle2 size={20} />
                            <span>{currentMenu.meal_type === 'dinner' ? '夕食を予約する' : '昼食を予約する'}</span>
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key="menu-card-empty" className="glass-card p-12 text-center space-y-4">
                    <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center text-stone-400 mx-auto">
                      <UtensilsCrossed size={32} />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-bold text-stone-800">
                        {selectedMealType === 'lunch' ? '昼食' : '夕食'}の献立は未登録です
                      </h3>
                      <p className="text-sm text-stone-500">
                        この日の{selectedMealType === 'lunch' ? '昼食' : '夕食'}は提供がないか、まだ登録されていません。
                      </p>
                    </div>
                  </div>
                )}

                {/* Gemini Advice (Shared for the day) */}
                <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 opacity-5 text-emerald-600">
                    <Info size={80} />
                  </div>
                  <h4 className="text-xs font-bold text-emerald-700 flex items-center gap-1 mb-2">
                    <Info size={14} />
                    今日の豆知識
                  </h4>
                  {loadingAdvice ? (
                    <div key="advice-loading" className="flex gap-1">
                      <div className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce" />
                      <div className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1 h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  ) : (
                    <p key="advice-content" className="text-xs text-emerald-800 leading-relaxed italic">
                      "{advice}"
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div key="menu-detail-empty" className="glass-card p-12 text-center space-y-4 sticky top-24">
                <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center text-stone-400 mx-auto">
                  <CalendarIcon size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-stone-800">日付を選択してください</h3>
                  <p className="text-sm text-stone-500">カレンダーから献立を確認したい日付を選んでください。</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-stone-200 lg:hidden flex justify-around py-3 px-6">
        <button className="flex flex-col items-center gap-1 text-emerald-600">
          <CalendarIcon size={20} />
          <span className="text-[10px] font-bold">献立</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-stone-400">
          <ClipboardList size={20} />
          <span className="text-[10px] font-bold">予約</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-stone-400">
          <UserIcon size={20} />
          <span className="text-[10px] font-bold">マイページ</span>
        </button>
      </nav>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast-notification"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 border ${
              toast.type === 'success' ? 'bg-emerald-600 text-white border-emerald-500' : 'bg-red-600 text-white border-red-500'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span className="text-sm font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scanning Overlay */}
      <AnimatePresence>
        {isScanning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-stone-900/60 backdrop-blur-md flex flex-col items-center justify-center space-y-6"
          >
            <div className="relative">
              <div className="w-24 h-24 border-4 border-emerald-500/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles size={32} className="text-emerald-500 animate-pulse" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-white">AIが献立を解析中...</h3>
              <p className="text-emerald-200/70 text-sm animate-pulse">
                しばらくお待ちください。PDFや画像の内容を読み取っています。
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm Modal */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div key="confirm-modal-overlay" className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 space-y-6"
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-stone-800">{confirmModal.title}</h3>
                  <p className="text-sm text-stone-500 leading-relaxed whitespace-pre-wrap">{confirmModal.message}</p>
                </div>

                {confirmModal.showInput && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-stone-400 uppercase tracking-wider">Gemini API Key</label>
                      <input
                        type="password"
                        value={confirmModal.inputValue}
                        onChange={(e) => setConfirmModal(prev => ({ ...prev, inputValue: e.target.value }))}
                        placeholder="AI Studioで取得したキーを入力"
                        className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      />
                      <div className="flex justify-between items-center px-1">
                        <div className="space-y-1">
                          <p className="text-[10px] text-stone-400">
                            1. <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline font-bold">こちら</a> を開き、右上の「API キーを作成」を押す
                          </p>
                          <p className="text-[10px] text-stone-400">
                            2. 「新しいプロジェクトで API キーを作成」を選択
                          </p>
                          <p className="text-[10px] text-red-500 font-bold mt-1">
                            ※「APIの制限」は必ず「なし」に設定してください
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            if (!confirmModal.inputValue) return;
                            setConfirmModal(prev => ({ ...prev, isTesting: true }));
                            const result = await validateApiKey(confirmModal.inputValue);
                            setConfirmModal(prev => ({ ...prev, isTesting: false }));
                            showToast(result.message, result.success ? 'success' : 'error');
                          }}
                          disabled={confirmModal.isTesting || !confirmModal.inputValue}
                          className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                        >
                          {confirmModal.isTesting ? 'テスト中...' : '接続テスト'}
                        </button>
                      </div>
                      <div className="pt-1">
                        <button
                          onClick={() => {
                            setManualApiKey('');
                            setConfirmModal(prev => ({ ...prev, inputValue: '', isOpen: false }));
                            showToast("APIキーをリセットしました。システムのデフォルト設定を使用します。");
                          }}
                          className="text-[10px] text-stone-400 hover:text-red-500 underline"
                        >
                          設定をクリアしてリセット
                        </button>
                      </div>
                    </div>

                    {!!(window as any).aistudio?.openSelectKey && (
                      <div className="pt-2">
                        <button
                          onClick={async () => {
                            // @ts-ignore
                            await window.aistudio.openSelectKey();
                            setConfirmModal(prev => ({ ...prev, isOpen: false }));
                          }}
                          className="w-full py-3 bg-stone-800 text-white rounded-2xl font-bold text-xs hover:bg-stone-900 transition-all flex items-center justify-center gap-2"
                        >
                          <Sparkles size={14} />
                          AI Studioから選択
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-2xl font-bold text-sm hover:bg-stone-200 transition-all"
                >
                  {confirmModal.cancelText || 'キャンセル'}
                </button>
                <button
                  onClick={() => confirmModal.onConfirm(confirmModal.inputValue)}
                  className={`flex-1 py-3 text-white rounded-2xl font-bold text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${
                    confirmModal.title.includes('削除') 
                      ? 'bg-red-600 hover:bg-red-700 shadow-red-200' 
                      : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                  }`}
                >
                  {confirmModal.confirmText === '保存' && <Save size={16} />}
                  {confirmModal.confirmText || (confirmModal.title.includes('削除') ? '削除する' : 'はい')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
