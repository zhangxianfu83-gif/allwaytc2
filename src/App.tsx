import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO, addDays, differenceInDays, startOfDay } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Solar } from 'lunar-javascript';
import { ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, ListTodo, Rabbit, LogOut, LogIn, User as UserIcon, AlertCircle, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Batch, Task, TASK_COLORS } from './types';
import { generateTasksForBatch, generateVaccineTasks, getShortTitle } from './utils';
import { auth, db, signInWithGoogle, logout, onAuthStateChanged, type User } from './firebase';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, writeBatch, getDoc } from 'firebase/firestore';

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

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  toast.error('数据库操作失败，请检查网络或权限');
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "应用程序出现错误";
      try {
        const errObj = JSON.parse(this.state.error.message);
        if (errObj.error) message = `数据库错误: ${errObj.error}`;
      } catch (e) {
        message = this.state.error.message || message;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-stone-800 mb-2">抱歉，出错了</h2>
            <p className="text-stone-600 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isTrueOffline, setIsTrueOffline] = useState(() => {
    return localStorage.getItem('is_true_offline') === 'true';
  });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  
  const [batches, setBatches] = useState<Batch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const validTasks = useMemo(() => {
    return tasks.filter(t => t.batchId === 'custom' || batches.some(b => b.id === t.batchId || (!t.batchId && b.name === t.batchName)));
  }, [tasks, batches]);

  const tasksByDate = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    validTasks.forEach(task => {
      if (!grouped[task.date]) grouped[task.date] = [];
      grouped[task.date].push(task);
    });
    
    // Pre-sort tasks within each date
    Object.keys(grouped).forEach(date => {
      grouped[date].sort((a, b) => {
        const aIsPostpartum = a.title.includes('月子餐');
        const bIsPostpartum = b.title.includes('月子餐');
        if (aIsPostpartum && !bIsPostpartum) return 1;
        if (!aIsPostpartum && bIsPostpartum) return -1;
        return 0;
      });
    });
    
    return grouped;
  }, [validTasks]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newBatchName, setNewBatchName] = useState('');
  const [newBatchDate, setNewBatchDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  
  const [newCustomTaskTitle, setNewCustomTaskTitle] = useState('');
  
  const [isVaccineModalOpen, setIsVaccineModalOpen] = useState(false);
  const [vaccineStartDate, setVaccineStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [batchToDelete, setBatchToDelete] = useState<Batch | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importPendingData, setImportPendingData] = useState<any>(null);

  const [activeTab, setActiveTab] = useState<'calendar' | 'tasks' | 'batches' | 'settings'>('calendar');
  const [direction, setDirection] = useState(0);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [isExitModalOpen, setIsExitModalOpen] = useState(false);

  const handleTabChange = (newTab: 'calendar' | 'tasks' | 'batches' | 'settings') => {
    if (newTab === activeTab) return;
    
    if (newTab === 'calendar') {
      history.back();
    } else {
      if (activeTab === 'calendar') {
        history.pushState({ page: newTab, appInitialized: true }, '', '');
      } else {
        history.replaceState({ page: newTab, appInitialized: true }, '', '');
      }
      setActiveTab(newTab);
    }
  };

  // History management for back button
  // This is crucial for Android apps built with Capacitor to handle the hardware back button
  useEffect(() => {
    if (!history.state?.appInitialized) {
      // Initialize state to handle exit confirmation
      history.replaceState({ page: 'exit_confirm', appInitialized: true }, '', '');
      history.pushState({ page: 'calendar', appInitialized: true }, '', '');
    } else {
      if (history.state.page && history.state.page !== 'exit_confirm') {
        setActiveTab(history.state.page);
      } else if (history.state.page === 'exit_confirm') {
        history.pushState({ page: 'calendar', appInitialized: true }, '', '');
        setActiveTab('calendar');
      }
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state?.page === 'exit_confirm') {
        // When user hits back button on the main screen, show exit confirmation
        setIsExitModalOpen(true);
        setActiveTab('calendar');
      } else if (state?.page) {
        // Navigate between tabs using back button
        setActiveTab(state.page);
        setIsExitModalOpen(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
      if (user) {
        setIsTrueOffline(false);
        localStorage.removeItem('is_true_offline');
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore sync
  useEffect(() => {
    if (isTrueOffline) {
      const localBatches = localStorage.getItem('offline_batches');
      const localTasks = localStorage.getItem('offline_tasks');
      if (localBatches) setBatches(JSON.parse(localBatches));
      if (localTasks) setTasks(JSON.parse(localTasks));
      return;
    }

    if (!isAuthReady || !user) {
      setBatches([]);
      setTasks([]);
      return;
    }

    const batchesQuery = query(collection(db, 'batches'), where('uid', '==', user.uid));
    const unsubscribeBatches = onSnapshot(batchesQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as Batch);
      // Ensure unique batches by ID
      const uniqueBatches = Array.from(new Map(data.map(item => [item.id, item])).values());
      setBatches(uniqueBatches);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'batches'));

    const tasksQuery = query(collection(db, 'tasks'), where('uid', '==', user.uid));
    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as Task);
      // Ensure unique tasks by ID to prevent UI duplicates if sync acts up
      const uniqueTasks = Array.from(new Map(data.map(item => [item.id, item])).values());
      setTasks(uniqueTasks);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'tasks'));

    return () => {
      unsubscribeBatches();
      unsubscribeTasks();
    };
  }, [isAuthReady, user]);

  const exportData = () => {
    const data = {
      batches,
      tasks: validTasks,
      version: '1.0',
      exportDate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `兔场数据备份_${format(new Date(), 'yyyyMMdd')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('数据已导出，请妥善保存备份文件');
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (data.batches && data.tasks) {
          setImportPendingData(data);
          setIsImportModalOpen(true);
        } else {
          toast.error('无效的备份文件格式');
        }
      } catch (err) {
        toast.error('解析备份文件失败');
      }
    };
    reader.readAsText(file);
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!newBatchName || !newBatchDate) return;
    if (!user && !isTrueOffline) return;

    const isDuplicate = batches.some(b => b.name === newBatchName && b.matingDate === newBatchDate);
    if (isDuplicate) {
      toast.error('该批次已存在，请勿重复添加');
      return;
    }

    const batchId = uuidv4();
    const newBatchData: Batch & { uid?: string } = {
      id: batchId,
      name: newBatchName,
      matingDate: newBatchDate,
      createdAt: Date.now(),
      uid: user?.uid
    };

    const newTasksData = generateTasksForBatch(newBatchData as Batch).map(t => ({ ...t, uid: user?.uid }));

    setIsSubmitting(true);
    if (isTrueOffline) {
      const updatedBatches = [...batches, newBatchData as Batch];
      const updatedTasks = [...tasks, ...newTasksData as Task[]];
      setBatches(updatedBatches);
      setTasks(updatedTasks);
      try {
        localStorage.setItem('offline_batches', JSON.stringify(updatedBatches));
        localStorage.setItem('offline_tasks', JSON.stringify(updatedTasks));
      } catch (e) {
        toast.error('本地存储空间不足，请清理旧数据');
        setIsSubmitting(false);
        return;
      }
      
      setIsModalOpen(false);
      setNewBatchName('');
      setNewBatchDate(format(new Date(), 'yyyy-MM-dd'));
      toast.success('繁育批次已创建 (本地保存)');
      setIsSubmitting(false);
      return;
    }

    try {
      // Perceived performance: close modal and reset form immediately
      setIsModalOpen(false);
      const tempBatchName = newBatchName;
      setNewBatchName('');
      setNewBatchDate(format(new Date(), 'yyyy-MM-dd'));

      // Split tasks into chunks of 450 to stay well within the Firestore 500-operation limit per batch
      const CHUNK_SIZE = 450;
      const allDocs = [
        { ref: doc(db, 'batches', batchId), data: newBatchData },
        ...newTasksData.map(t => ({ ref: doc(db, 'tasks', t.id), data: t }))
      ];

      const commitPromises = [];
      for (let i = 0; i < allDocs.length; i += CHUNK_SIZE) {
        const fbBatch = writeBatch(db);
        const chunk = allDocs.slice(i, i + CHUNK_SIZE);
        chunk.forEach(item => {
          fbBatch.set(item.ref, item.data);
        });
        commitPromises.push(fbBatch.commit());
      }

      Promise.all(commitPromises)
        .then(() => {
          toast.success(`繁育批次 "${tempBatchName}" 已创建`);
        })
        .catch(error => {
          handleFirestoreError(error, OperationType.WRITE, 'batches/tasks');
        })
        .finally(() => {
          setIsSubmitting(false);
        });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'batches/tasks');
      setIsSubmitting(false);
    }
  };

  const handleAddVaccine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!vaccineStartDate) return;
    if (!user && !isTrueOffline) return;

    const isDuplicate = batches.some(b => b.name === '兔瘟普免' && b.matingDate === vaccineStartDate);
    if (isDuplicate) {
      toast.error('该日期的免疫计划已存在，请勿重复添加');
      return;
    }

    const batchId = uuidv4();
    const newBatchData: Batch & { uid?: string } = {
      id: batchId,
      name: '兔瘟普免',
      matingDate: vaccineStartDate,
      createdAt: Date.now(),
      uid: user?.uid
    };

    const newTasksData = generateVaccineTasks(newBatchData.id, newBatchData.name, vaccineStartDate).map(t => ({ ...t, uid: user?.uid }));

    setIsSubmitting(true);
    if (isTrueOffline) {
      const updatedBatches = [...batches, newBatchData as Batch];
      const updatedTasks = [...tasks, ...newTasksData as Task[]];
      setBatches(updatedBatches);
      setTasks(updatedTasks);
      try {
        localStorage.setItem('offline_batches', JSON.stringify(updatedBatches));
        localStorage.setItem('offline_tasks', JSON.stringify(updatedTasks));
      } catch (e) {
        toast.error('本地存储空间不足，请清理旧数据');
        setIsSubmitting(false);
        return;
      }

      setIsVaccineModalOpen(false);
      setVaccineStartDate(format(new Date(), 'yyyy-MM-dd'));
      toast.success('免疫计划已创建 (本地保存)');
      setIsSubmitting(false);
      return;
    }

    try {
      // Perceived performance: close modal immediately
      setIsVaccineModalOpen(false);
      setVaccineStartDate(format(new Date(), 'yyyy-MM-dd'));

      // Split tasks into chunks of 450 to stay well within the 500 limit
      // Although vaccine tasks are currently few, this ensures scalability
      const CHUNK_SIZE = 450;
      const allDocs = [
        { ref: doc(db, 'batches', batchId), data: newBatchData },
        ...newTasksData.map(t => ({ ref: doc(db, 'tasks', t.id), data: t }))
      ];

      const commitPromises = [];
      for (let i = 0; i < allDocs.length; i += CHUNK_SIZE) {
        const fbBatch = writeBatch(db);
        const chunk = allDocs.slice(i, i + CHUNK_SIZE);
        chunk.forEach(item => {
          fbBatch.set(item.ref, item.data);
        });
        commitPromises.push(fbBatch.commit());
      }
      
      Promise.all(commitPromises)
        .then(() => {
          toast.success('免疫计划已创建');
        })
        .catch(error => {
          handleFirestoreError(error, OperationType.WRITE, 'batches/tasks');
        })
        .finally(() => {
          setIsSubmitting(false);
        });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'batches/tasks');
      setIsSubmitting(false);
    }
  };

  const handleAddCustomTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomTaskTitle.trim()) return;

    const newTask: Task = {
      id: uuidv4(),
      batchId: 'custom',
      batchName: '自定义',
      title: newCustomTaskTitle.trim(),
      date: format(selectedDate, 'yyyy-MM-dd'),
      completed: false,
      type: 'custom',
      uid: user?.uid
    };

    if (isTrueOffline) {
      const updatedTasks = [...tasks, newTask];
      setTasks(updatedTasks);
      localStorage.setItem('offline_tasks', JSON.stringify(updatedTasks));
      setNewCustomTaskTitle('');
      toast.success('自定义任务已添加 (本地保存)');
      return;
    }

    if (!user) {
      toast.error('请先登录');
      return;
    }

    try {
      await setDoc(doc(db, 'tasks', newTask.id), newTask);
      setNewCustomTaskTitle('');
      toast.success('自定义任务已添加');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'tasks');
    }
  };

  const handleDeleteCustomTask = async (taskId: string) => {
    if (isTrueOffline) {
      const updatedTasks = tasks.filter(t => t.id !== taskId);
      setTasks(updatedTasks);
      localStorage.setItem('offline_tasks', JSON.stringify(updatedTasks));
      toast.success('自定义任务已删除 (本地保存)');
      return;
    }

    if (!user) return;

    try {
      await deleteDoc(doc(db, 'tasks', taskId));
      toast.success('自定义任务已删除');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'tasks');
    }
  };

  const toggleTaskCompletion = async (taskIds: string[], currentCompleted: boolean) => {
    if (isTrueOffline) {
      const updatedTasks = tasks.map(t => taskIds.includes(t.id) ? { ...t, completed: !currentCompleted } : t);
      setTasks(updatedTasks);
      localStorage.setItem('offline_tasks', JSON.stringify(updatedTasks));
      return;
    }

    if (!user) return;

    try {
      const batch = writeBatch(db);
      taskIds.forEach(id => {
        const taskRef = doc(db, 'tasks', id);
        batch.update(taskRef, { completed: !currentCompleted });
      });
      batch.commit().catch(error => {
        handleFirestoreError(error, OperationType.UPDATE, `tasks`);
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks`);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (isTrueOffline) {
      const updatedTasks = tasks.filter(t => t.id !== taskId);
      setTasks(updatedTasks);
      localStorage.setItem('offline_tasks', JSON.stringify(updatedTasks));
      toast.success('任务已删除');
      return;
    }

    if (!user) return;
    try {
      deleteDoc(doc(db, 'tasks', taskId)).catch(error => {
        handleFirestoreError(error, OperationType.DELETE, `tasks/${taskId}`);
      });
      toast.success('任务已删除');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tasks/${taskId}`);
    }
  };

  const deleteBatch = (batchId: string) => {
    const batch = batches.find(b => b.id === batchId);
    if (batch) {
      setBatchToDelete(batch);
      setIsDeleteModalOpen(true);
    }
  };

  const confirmDeleteBatch = async () => {
    if (isSubmitting) return;
    if (!batchToDelete) return;
    
    setIsSubmitting(true);
    if (isTrueOffline) {
      const updatedBatches = batches.filter(b => b.id !== batchToDelete.id);
      const updatedTasks = tasks.filter(t => t.batchId !== batchToDelete.id && (t.batchId || t.batchName !== batchToDelete.name));
      setBatches(updatedBatches);
      setTasks(updatedTasks);
      localStorage.setItem('offline_batches', JSON.stringify(updatedBatches));
      localStorage.setItem('offline_tasks', JSON.stringify(updatedTasks));
      
      setIsDeleteModalOpen(false);
      setBatchToDelete(null);
      setIsSubmitting(false);
      toast.success('批次及相关任务已删除');
      return;
    }

    if (user) {
      try {
        // Perceived performance: close modal immediately
        setIsDeleteModalOpen(false);
        const tempBatchName = batchToDelete.name;

        const batchTasks = tasks.filter(t => t.batchId === batchToDelete.id || (!t.batchId && t.batchName === batchToDelete.name));
        
        // Split deletions into chunks of 450 to stay well within the Firestore 500-operation limit per batch
        const CHUNK_SIZE = 450;
        
        const allRefs = [
          doc(db, 'batches', batchToDelete.id),
          ...batchTasks.map(t => doc(db, 'tasks', t.id))
        ];

        const commitPromises = [];
        for (let i = 0; i < allRefs.length; i += CHUNK_SIZE) {
          const fbBatch = writeBatch(db);
          const chunk = allRefs.slice(i, i + CHUNK_SIZE);
          chunk.forEach(ref => {
            fbBatch.delete(ref);
          });
          commitPromises.push(fbBatch.commit());
        }
        
        Promise.all(commitPromises)
          .then(() => {
            toast.success(`批次 "${tempBatchName}" 及相关任务已删除`);
          })
          .catch(error => {
            handleFirestoreError(error, OperationType.DELETE, 'batches/tasks');
          })
          .finally(() => {
            setBatchToDelete(null);
            setIsSubmitting(false);
          });

      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'batches/tasks');
        setIsDeleteModalOpen(false);
        setBatchToDelete(null);
        setIsSubmitting(false);
      }
    }
  };

  const nextMonth = () => {
    setDirection(1);
    setCurrentDate(addMonths(currentDate, 1));
  };

  const prevMonth = () => {
    setDirection(-1);
    setCurrentDate(subMonths(currentDate, 1));
  };

  const goToToday = () => {
    setDirection(0);
    setCurrentDate(new Date());
  };

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }

    const checkNotifications = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const dateStr = format(now, 'yyyy-MM-dd');
      
      // Morning notification (7:00 AM)
      if (hours === 7 && minutes === 0) {
        const lastNotified = localStorage.getItem('last_notified_morning');
        if (lastNotified !== dateStr) {
          const todayTasks = (tasksByDate[dateStr] || []).filter(t => !t.completed);
          if (todayTasks.length > 0) {
            const message = `今天有 ${todayTasks.length} 个任务待处理：${todayTasks.slice(0, todayTasks.length > 4 ? 3 : 4).map(t => getShortTitle(t.title)).join(', ')}${todayTasks.length > 4 ? '...' : ''}`;
            showNotification('今日工作提醒', message);
            localStorage.setItem('last_notified_morning', dateStr);
          }
        }
      }
      
      // Afternoon notification (4:00 PM)
      if (hours === 16 && minutes === 0) {
        const lastNotified = localStorage.getItem('last_notified_afternoon');
        if (lastNotified !== dateStr) {
          const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd');
          const tomorrowTasks = tasksByDate[tomorrow] || [];
          if (tomorrowTasks.length > 0) {
            const message = `明天有 ${tomorrowTasks.length} 个任务：${tomorrowTasks.slice(0, tomorrowTasks.length > 4 ? 3 : 4).map(t => getShortTitle(t.title)).join(', ')}${tomorrowTasks.length > 4 ? '...' : ''}`;
            showNotification('明日工作预览', message);
            localStorage.setItem('last_notified_afternoon', dateStr);
          }
        }
      }
    };

    const showNotification = (title: string, body: string) => {
      // Show in-app toast
      toast(title, {
        description: body,
        duration: 10000,
      });

      // Show browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    };

    const interval = setInterval(checkNotifications, 60000); // Check every minute
    checkNotifications(); // Check immediately on mount

    return () => clearInterval(interval);
  }, [tasksByDate]);

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === 'granted') {
        toast.success('通知已开启');
      }
    }
  };

  const handlePanEnd = (_: any, info: any) => {
    const threshold = 50;
    if (info.offset.y < -threshold) {
      nextMonth();
    } else if (info.offset.y > threshold) {
      prevMonth();
    }
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const startDate = monthStart; // We can adjust to show previous month days if needed
  const endDate = monthEnd;
  const dateFormat = "yyyy-MM-dd";

  const days = eachDayOfInterval({
    start: startDate,
    end: endDate
  });

  // Pad the beginning of the month with empty days to align with weekday
  const startDayOfWeek = monthStart.getDay(); // 0 is Sunday
  const paddingDays = Array.from({ length: startDayOfWeek === 0 ? 6 : startDayOfWeek - 1 }).fill(null);
  // Adjust padding if week starts on Monday (1)
  const adjustedPadding = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
  const emptyDays = Array.from({ length: adjustedPadding }).map((_, i) => <div key={`empty-${i}`} className="h-16 lg:h-24 border border-gray-100 bg-gray-50/50"></div>);

  const groupTasks = (tasksToGroup: Task[]) => {
    return tasksToGroup.reduce((acc, task) => {
      const existing = acc.find(t => t.title === task.title);
      
      const clean = (n: string) => n.replace('批', '');
      const taskBase = clean(task.batchName);

      if (existing) {
        const names = existing.batchName.split('、');
        let foundMatch = false;
        for (let i = 0; i < names.length; i++) {
          if (clean(names[i]) === taskBase) {
            foundMatch = true;
            if (task.batchName.includes('批') && !names[i].includes('批')) {
              names[i] = task.batchName;
            }
            break;
          }
        }
        
        if (!foundMatch) {
          names.push(task.batchName);
        }
        
        existing.batchName = names.join('、');
        existing.ids.push(task.id);
        existing.completed = existing.completed && task.completed;
      } else {
        acc.push({ ...task, ids: [task.id] });
      }
      return acc;
    }, [] as (Task & { ids: string[] })[]);
  };

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const rawSelectedDayTasks = [...(tasksByDate[selectedDateStr] || [])].sort((a, b) => {
    if (a.completed === b.completed) return 0;
    return a.completed ? 1 : -1;
  });
  const selectedDayTasks = groupTasks(rawSelectedDayTasks);

  const activeLitters = batches
    .filter(b => !b.name.includes('全场') && !b.name.includes('兔瘟') && !b.name.includes('普免') && !b.name.includes('免疫') && !b.name.includes('疫苗'))
    .flatMap(batch => {
    const mDate = startOfDay(new Date(batch.matingDate));
    const sDate = startOfDay(selectedDate);
    const litters = [];
    
    for (let i = 0; i < 10; i++) {
      const birthDate = addDays(mDate, i * 42 + 30);
      const age = differenceInDays(sDate, birthDate);
      
      if (age >= 0 && age <= 70) {
        litters.push({
          batchName: batch.name,
          birthDateStr: format(birthDate, 'M月d日'),
          age
        });
      }
    }
    return litters;
  })
  .reduce((acc, litter) => {
    const existing = acc.find(l => l.birthDateStr === litter.birthDateStr && l.age === litter.age);
    const clean = (n: string) => n.replace('批', '');
    const newBase = clean(litter.batchName);

    if (existing) {
      const names = existing.batchName.split('、');
      let foundMatch = false;
      for (let i = 0; i < names.length; i++) {
        if (clean(names[i]) === newBase) {
          foundMatch = true;
          if (litter.batchName.includes('批') && !names[i].includes('批')) {
            names[i] = litter.batchName;
          }
          break;
        }
      }
      if (!foundMatch) {
        names.push(litter.batchName);
      }
      existing.batchName = names.join('、');
    } else {
      acc.push({ ...litter });
    }
    return acc;
  }, [] as { batchName: string, birthDateStr: string, age: number }[]);

  const confirmImportData = async () => {
    if (isSubmitting) return;
    if (importPendingData && user) {
      setIsSubmitting(true);
      try {
        const currentBatches = batches;
        const currentTasks = tasks;
        const newBatches = Array.from(new Map(importPendingData.batches.map((b: any) => [b.id, b])).values());
        const newTasks = Array.from(new Map(importPendingData.tasks.map((t: any) => [t.id, t])).values());

        const operations: { type: 'set' | 'delete', collection: string, id: string, data?: any }[] = [];
        
        // Mark current data for deletion
        currentBatches.forEach(b => operations.push({ type: 'delete', collection: 'batches', id: b.id }));
        currentTasks.forEach(t => operations.push({ type: 'delete', collection: 'tasks', id: t.id }));
        
        // Mark new data for setting
        newBatches.forEach((b: any) => operations.push({ type: 'set', collection: 'batches', id: b.id, data: { ...b, uid: user.uid } }));
        newTasks.forEach((t: any) => operations.push({ type: 'set', collection: 'tasks', id: t.id, data: { ...t, uid: user.uid } }));

        // Split operations into chunks of 450 to stay well within the Firestore 500-operation limit per batch
        const CHUNK_SIZE = 450;
        const commitPromises = [];
        
        for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
          const chunk = operations.slice(i, i + CHUNK_SIZE);
          const fbBatch = writeBatch(db);
          chunk.forEach(op => {
            const docRef = doc(db, op.collection, op.id);
            if (op.type === 'delete') {
              fbBatch.delete(docRef);
            } else {
              fbBatch.set(docRef, op.data);
            }
          });
          commitPromises.push(fbBatch.commit());
        }
        
        await Promise.all(commitPromises);
        
        setIsImportModalOpen(false);
        setImportPendingData(null);
        toast.success('数据导入成功');
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'import');
      } finally {
        setIsSubmitting(false);
      }
    } else if (importPendingData && isTrueOffline) {
      // Handle offline import
      const newBatches = Array.from(new Map(importPendingData.batches.map((b: any) => [b.id, b])).values()) as Batch[];
      const newTasks = Array.from(new Map(importPendingData.tasks.map((t: any) => [t.id, t])).values()) as Task[];
      
      setBatches(newBatches);
      setTasks(newTasks);
      localStorage.setItem('offline_batches', JSON.stringify(newBatches));
      localStorage.setItem('offline_tasks', JSON.stringify(newTasks));
      
      setIsImportModalOpen(false);
      setImportPendingData(null);
      toast.success('数据导入成功 (本地)');
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="animate-spin text-emerald-600">
          <Rabbit size={48} />
        </div>
      </div>
    );
  }

  if (!user && !isTrueOffline) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 lg:p-12 rounded-3xl shadow-xl max-w-md w-full text-center">
          <div className="bg-emerald-100 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <img src="/logo.png" alt="Logo" className="w-16 h-16 object-contain" onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rabbit text-emerald-700"><path d="M13 16a3 3 0 0 1 2.24 5"/><path d="M18 12h.01"/><path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1c-1.7 0-3 1.3-3 3"/><path d="M20 8.54V4a2 2 0 1 0-4 0v3"/><path d="M7.61 12.53a3 3 0 1 0-5.71-2.1"/><path d="M8.73 15.39a3 3 0 1 0-4.63-4.4"/><path d="M9 21h-2a2 2 0 0 1 0-4h2"/></svg>';
            }} />
          </div>
          <h1 className="text-2xl font-bold text-stone-800 mb-1">澳威兔场日程管理</h1>
          <p className="text-stone-500 mb-8">专为养兔户设计的生产管理工具</p>
          
          <div className="space-y-4">
            <button 
              onClick={() => {
                setIsTrueOffline(true);
                localStorage.setItem('is_true_offline', 'true');
                toast.success('已进入本地离线模式');
              }}
              className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-xl font-bold transition-all shadow-md active:scale-95"
            >
              直接开始使用 (离线模式)
            </button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-stone-200"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-stone-400">或者使用账号登录</span>
              </div>
            </div>

            <button 
              onClick={() => {
                const email = window.prompt('请输入邮箱/账号:');
                const password = window.prompt('请输入密码:');
                if (email && password) {
                  const toastId = toast.loading('正在登录...');
                  import('./firebase').then(({ loginWithEmail }) => {
                    loginWithEmail(email, password)
                      .then(() => toast.success('登录成功', { id: toastId }))
                      .catch((err) => {
                        if (err.code === 'auth/user-not-found') {
                          if (window.confirm('账号不存在，是否以此信息注册新账号？')) {
                            import('./firebase').then(({ registerWithEmail }) => {
                              registerWithEmail(email, password)
                                .then(() => toast.success('注册并登录成功', { id: toastId }))
                                .catch(e => toast.error('注册失败：' + e.message, { id: toastId }));
                            });
                          } else {
                            toast.dismiss(toastId);
                          }
                        } else {
                          toast.error('登录失败：' + err.message, { id: toastId });
                        }
                      });
                  });
                }
              }}
              className="w-full flex items-center justify-center gap-3 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 py-3.5 rounded-xl font-semibold transition-all shadow-sm"
            >
              <UserIcon size={20} />
              账号密码登录
            </button>

            <button 
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 py-3.5 rounded-xl font-semibold transition-all shadow-sm opacity-60"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
              使用 Google 账号登录
            </button>
          </div>

          <div className="mt-8 p-4 bg-amber-50 rounded-xl border border-amber-100 text-left">
            <h3 className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-1">
              <AlertCircle size={14} />
              温馨提示
            </h3>
            <p className="text-[10px] text-amber-700 leading-relaxed">
              1. <b>游客模式</b>：无需注册，数据保存在手机里。换手机或清除浏览器缓存会导致数据丢失。<br/>
              2. <b>账号登录</b>：数据同步到云端，换手机也能看。建议长期使用。
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans pb-20 lg:pb-0">
      <Toaster position="top-center" />
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-100 p-1.5 rounded-lg">
              <img src="/logo.png" alt="Logo" className="w-8 h-8 object-contain" onError={(e) => {
                // Fallback to icon if image fails to load
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rabbit"><path d="M13 16a3 3 0 0 1 2.24 5"/><path d="M18 12h.01"/><path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1c-1.7 0-3 1.3-3 3"/><path d="M20 8.54V4a2 2 0 1 0-4 0v3"/><path d="M7.61 12.53a3 3 0 1 0-5.71-2.1"/><path d="M8.73 15.39a3 3 0 1 0-4.63-4.4"/><path d="M9 21h-2a2 2 0 0 1 0-4h2"/></svg>';
              }} />
            </div>
            <div className="flex flex-col">
              <h1 className="text-lg lg:text-xl font-bold tracking-tight text-stone-800 leading-tight">澳威兔场日程管理</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 lg:gap-4">
            <div className="hidden lg:flex items-center gap-3">
              <button
                onClick={() => setIsVaccineModalOpen(true)}
                className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
              >
                <Plus size={18} />
                <span>新增免疫计划</span>
              </button>
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
              >
                <Plus size={18} />
                <span>新增繁育批次</span>
              </button>
            </div>
            
            <div className="h-8 w-px bg-stone-200 hidden lg:block mx-1"></div>
            
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-stone-800 truncate max-w-[100px]">
                  {isTrueOffline ? '离线模式' : (user?.isAnonymous ? '游客' : (user?.displayName || '用户'))}
                </span>
                <button 
                  onClick={() => {
                    if (isTrueOffline) {
                      setIsTrueOffline(false);
                      localStorage.removeItem('is_true_offline');
                    } else {
                      logout();
                    }
                  }} 
                  className="text-[10px] text-stone-400 hover:text-red-500 transition-colors"
                >
                  退出{isTrueOffline ? '离线' : '登录'}
                </button>
              </div>
              <img src={user?.photoURL || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + (user?.uid || 'offline')} className="w-8 h-8 rounded-full border border-stone-200 bg-stone-100" alt="Avatar" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-1 sm:px-6 lg:px-8 py-2 lg:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Calendar Section */}
          <div className={`lg:col-span-2 bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden ${activeTab !== 'calendar' ? 'hidden lg:block' : 'block'}`}>
            <div className="p-2 lg:p-6 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-lg lg:text-xl font-bold flex items-center gap-2">
                <CalendarIcon size={24} className="text-stone-500" />
                {format(currentDate, 'yyyy年 M月', { locale: zhCN })}
              </h2>
              <div className="flex items-center gap-1 lg:gap-2">
                {notificationPermission !== 'granted' && (
                  <button 
                    onClick={requestNotificationPermission}
                    className="p-2 lg:p-2 text-stone-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-full transition-all"
                    title="开启通知提醒"
                  >
                    <div className="relative">
                      <CalendarIcon size={24} />
                      <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></div>
                    </div>
                  </button>
                )}
                <button 
                  onClick={prevMonth}
                  className="p-2 lg:p-2 hover:bg-stone-100 rounded-full transition-colors"
                >
                  <ChevronLeft size={24} />
                </button>
                <button 
                  onClick={goToToday}
                  className="px-3 lg:px-3 py-1.5 text-sm lg:text-base font-bold hover:bg-stone-100 rounded-full transition-colors"
                >
                  今天
                </button>
                <button 
                  onClick={nextMonth}
                  className="p-2 lg:p-2 hover:bg-stone-100 rounded-full transition-colors"
                >
                  <ChevronRight size={24} />
                </button>
              </div>
            </div>
            
            <div className="p-2 lg:p-6 relative">
              <div className="grid grid-cols-7 gap-1 mb-1 lg:mb-2">
                {['一', '二', '三', '四', '五', '六', '日'].map(day => (
                  <div key={day} className="text-center text-xs lg:text-sm font-bold text-stone-600 py-1 lg:py-2">
                    {day}
                  </div>
                ))}
              </div>
              
              <div className="overflow-hidden relative min-h-[400px] lg:min-h-[500px]">
                <AnimatePresence initial={false} mode="popLayout" custom={direction}>
                  <motion.div
                    key={currentDate.toISOString()}
                    custom={direction}
                    variants={{
                      enter: (direction: number) => ({
                        y: direction > 0 ? 100 : direction < 0 ? -100 : 0,
                        opacity: 0,
                      }),
                      center: {
                        y: 0,
                        opacity: 1,
                      },
                      exit: (direction: number) => ({
                        y: direction > 0 ? -100 : direction < 0 ? 100 : 0,
                        opacity: 0,
                      }),
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      y: { type: "spring", stiffness: 300, damping: 30 },
                      opacity: { duration: 0.2 }
                    }}
                    onDragEnd={handlePanEnd}
                    drag="y"
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={0.2}
                    className="grid grid-cols-7 gap-1 lg:gap-2 w-full touch-none"
                  >
                    {emptyDays}
                    {days.map(day => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const rawDayTasks = tasksByDate[dateStr] || [];
                      const dayTasks = groupTasks(rawDayTasks);
                      const isSelected = isSameDay(day, selectedDate);
                      const isToday = isSameDay(day, new Date());
                      
                      return (
                        <div 
                          key={day.toString()}
                          onClick={() => {
                            setSelectedDate(day);
                            if (window.innerWidth < 1024) handleTabChange('tasks');
                          }}
                          className={`
                            min-h-[80px] lg:min-h-[100px] p-1 lg:p-2 rounded-md lg:rounded-xl border transition-all cursor-pointer flex flex-col
                            ${isSelected ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/30' : 'border-stone-200 hover:border-emerald-300 hover:bg-stone-50'}
                          `}
                        >
                          <div className="flex justify-between items-start mb-0.5 lg:mb-1">
                            <span className={`
                              text-sm lg:text-base font-bold w-6 h-6 lg:w-7 lg:h-7 flex items-center justify-center rounded-full
                              ${isToday ? 'bg-emerald-600 text-white' : 'text-stone-700'}
                            `}>
                              {format(day, 'd')}
                            </span>
                            {dayTasks.length > 0 && (
                              <span className="text-xs lg:text-xs font-bold text-stone-600 bg-stone-100 px-1.5 lg:px-1.5 py-0.5 rounded-md">
                                {dayTasks.length}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 overflow-y-auto space-y-0.5 lg:space-y-1 mt-0.5 lg:mt-1 no-scrollbar">
                            {/* Mobile view: short titles */}
                            <div className="lg:hidden flex flex-col gap-0.5 overflow-hidden">
                              {(dayTasks.length > 4 
                                ? dayTasks.filter(t => !t.title.includes('月子餐')) 
                                : dayTasks
                              ).slice(0, dayTasks.length > 4 ? 3 : 4).map(task => (
                                <div 
                                  key={task.id} 
                                  className={`text-[8px] leading-tight truncate px-0 py-px rounded border tracking-tighter ${TASK_COLORS[task.type]} ${task.completed ? 'opacity-50' : ''}`}
                                >
                                  {task.batchName === '自定义' ? getShortTitle(task.title) : (task.batchName === getShortTitle(task.title) ? task.batchName : `${task.batchName} ${getShortTitle(task.title)}`)}
                                </div>
                              ))}
                              {dayTasks.length > 4 && (
                                <div className="text-[8px] text-stone-500 text-center font-medium tracking-tighter">
                                  +{dayTasks.length - (dayTasks.length > 4 ? dayTasks.filter(t => !t.title.includes('月子餐')).slice(0, 3).length : 4)}
                                </div>
                              )}
                            </div>
                            {/* Desktop view: text labels */}
                            <div className="hidden lg:block space-y-1">
                              {dayTasks.slice(0, dayTasks.length > 4 ? 3 : 4).map(task => (
                                <div 
                                  key={task.id} 
                                  className={`text-[10px] truncate px-1 py-0.5 rounded border tracking-tight ${TASK_COLORS[task.type]} ${task.completed ? 'opacity-50 line-through' : ''}`}
                                  title={`${task.batchName}: ${task.title}`}
                                >
                                  {task.batchName === '自定义' ? getShortTitle(task.title) : (task.batchName === getShortTitle(task.title) ? task.batchName : `${task.batchName} ${getShortTitle(task.title)}`)}
                                </div>
                              ))}
                              {dayTasks.length > 4 && (
                                <div className="text-[10px] text-stone-500 pl-1 tracking-tight">
                                  +{dayTasks.length - 3} 更多
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Sidebar / Task List */}
          <div className={`space-y-6 ${activeTab === 'calendar' ? 'hidden lg:block' : activeTab === 'tasks' ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden flex flex-col h-[calc(100vh-12rem)] lg:h-[600px]">
              <div className="p-3 lg:p-4 border-b border-stone-200 bg-stone-50/50">
                <h2 className="text-lg lg:text-xl font-bold flex items-center gap-2">
                  <ListTodo size={24} className="text-emerald-600" />
                  <span>{format(selectedDate, 'M月d日', { locale: zhCN })} 任务清单</span>
                  <span className="text-sm lg:text-base font-medium text-stone-600 ml-1">
                    (农历{Solar.fromDate(selectedDate).getLunar().getMonthInChinese()}月{Solar.fromDate(selectedDate).getLunar().getDayInChinese()})
                  </span>
                </h2>
                <p className="text-sm lg:text-base text-stone-600 mt-1">
                  {selectedDayTasks.length === 0 ? '今天没有安排任务' : `共 ${selectedDayTasks.length} 项任务，已完成 ${selectedDayTasks.filter(t => t.completed).length} 项`}
                </p>
              </div>
              
              {activeLitters.length > 0 && (
                <div className="px-3 pt-3 lg:px-4 lg:pt-4">
                  <h3 className="text-xs lg:text-sm font-bold text-stone-600 mb-1.5 uppercase tracking-wider">当前小兔批次</h3>
                  <div className="flex flex-wrap gap-1.5 lg:gap-2">
                    {activeLitters.map((litter, idx) => (
                      <div key={idx} className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 lg:px-3 lg:py-2 rounded-lg text-xs lg:text-sm flex items-center gap-1.5 lg:gap-2">
                        <Rabbit size={16} />
                        <span>{litter.batchName} ({litter.birthDateStr})</span>
                        <span className="font-bold">{litter.age}日龄</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3 lg:p-4 flex-1 overflow-y-auto space-y-2">
                {selectedDayTasks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-stone-400 space-y-3">
                    <Rabbit size={48} className="opacity-20" />
                    <p className="text-base">今天可以休息一下</p>
                  </div>
                ) : (
                  selectedDayTasks.map(task => (
                    <div 
                      key={task.id}
                      className={`
                        p-3 lg:p-4 rounded-xl border transition-all
                        ${task.completed ? 'bg-stone-50 border-stone-200 opacity-60' : 'bg-white border-stone-200 shadow-sm hover:border-emerald-300'}
                      `}
                    >
                      <div className="flex items-start gap-3">
                        <button 
                          onClick={() => toggleTaskCompletion(task.ids, task.completed)}
                          className={`
                            mt-0.5 w-6 h-6 lg:w-7 lg:h-7 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors
                            ${task.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 hover:border-emerald-500'}
                          `}
                        >
                          {task.completed && <svg viewBox="0 0 14 14" fill="none" className="w-4 h-4 lg:w-5 lg:h-5"><path d="M3 7.5L5.5 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-base lg:text-lg text-stone-900 truncate block">
                              {task.batchName}
                            </span>
                            <span className={`text-xs lg:text-sm px-2 py-0.5 rounded-full border font-medium ${TASK_COLORS[task.type]}`}>
                              {getShortTitle(task.title)}
                            </span>
                          </div>
                          <p className={`text-sm lg:text-base font-medium ${task.completed ? 'line-through text-stone-400' : 'text-stone-700'}`}>
                            {task.title}
                          </p>
                        </div>
                        {task.type === 'custom' && task.batchId === 'custom' && (
                          <button
                            onClick={() => handleDeleteCustomTask(task.id)}
                            className="p-1.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="删除自定义任务"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              <div className="p-4 border-t border-stone-200 bg-stone-50/50">
                <form onSubmit={handleAddCustomTask} className="flex gap-2">
                  <input
                    type="text"
                    value={newCustomTaskTitle}
                    onChange={(e) => setNewCustomTaskTitle(e.target.value)}
                    placeholder="添加自定义任务..."
                    className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 bg-white"
                  />
                  <button
                    type="submit"
                    disabled={!newCustomTaskTitle.trim()}
                    className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                  >
                    <Plus size={18} />
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Batch List Summary */}
          <div className={`space-y-6 ${activeTab === 'batches' ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-4 lg:p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-stone-800">繁育及免疫批次</h3>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsVaccineModalOpen(true)}
                  className="lg:hidden px-3 py-1.5 bg-cyan-50 text-cyan-600 rounded-lg text-xs font-bold border border-cyan-100"
                >
                  免疫计划
                </button>
                <button 
                  onClick={() => setIsModalOpen(true)}
                  className="lg:hidden px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold border border-emerald-100"
                >
                  新增批次
                </button>
              </div>
              </div>
              <div className="space-y-3 max-h-[calc(100vh-16rem)] lg:max-h-[300px] overflow-y-auto pr-2">
                {batches.length === 0 ? (
                  <p className="text-sm text-stone-500 text-center py-4">暂无批次</p>
                ) : (
                  batches.map(batch => (
                    <div key={batch.id} className="flex items-center justify-between p-3 rounded-lg border border-stone-100 bg-stone-50">
                      <div>
                        <div className="font-medium text-sm text-stone-800">{batch.name}</div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          {batch.name.includes('免疫') || batch.name.includes('疫苗') || batch.name.includes('普免') || batch.name.includes('兔瘟') ? '免疫' : '配种'}: {batch.matingDate}
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteBatch(batch.id)}
                        className="text-stone-400 hover:text-red-500 p-1.5"
                        title="删除批次"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Settings Section */}
          <div className={`space-y-6 ${activeTab === 'settings' ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6">
              <h3 className="font-semibold text-stone-800 mb-4">数据管理</h3>
              <div className="space-y-4">
                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    云端同步已开启。您的数据已安全存储在服务器上，换手机登录账号即可找回。
                  </p>
                </div>
                
                <div className="flex flex-col gap-2">
                  <button 
                    onClick={exportData}
                    className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 py-3 rounded-xl font-medium transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    备份数据到本地
                  </button>

                  <div className="relative">
                    <input 
                      type="file" 
                      accept=".json"
                      onChange={importData}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                    />
                    <button className="w-full flex items-center justify-center gap-2 bg-white border border-stone-200 hover:bg-stone-50 text-stone-700 py-3 rounded-xl font-medium transition-all">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                      从备份文件恢复
                    </button>
                  </div>

                  <button 
                    onClick={logout}
                    className="w-full flex items-center justify-center gap-2 bg-red-50 border border-red-100 hover:bg-red-100 text-red-600 py-3 rounded-xl font-medium transition-all"
                  >
                    <LogOut size={18} />
                    退出当前账号
                  </button>
                </div>

                <div className="pt-4 border-t border-stone-100">
                  <p className="text-[10px] text-stone-400 text-center">
                    版本: 1.0.2 | 澳威兔场日程管理 | 制作人：张现富13355491366
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 h-16 flex items-center justify-around z-40 px-2">
        <button 
          onClick={() => handleTabChange('calendar')}
          className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'calendar' ? 'text-emerald-600' : 'text-stone-400'}`}
        >
          <CalendarIcon size={24} />
          <span className="text-xs font-bold">日历</span>
        </button>
        <button 
          onClick={() => handleTabChange('tasks')}
          className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'tasks' ? 'text-emerald-600' : 'text-stone-400'}`}
        >
          <ListTodo size={24} />
          <span className="text-xs font-bold">任务</span>
        </button>
        <button 
          onClick={() => handleTabChange('batches')}
          className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'batches' ? 'text-emerald-600' : 'text-stone-400'}`}
        >
          <Rabbit size={24} />
          <span className="text-xs font-bold">批次</span>
        </button>
        <button 
          onClick={() => handleTabChange('settings')}
          className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'settings' ? 'text-emerald-600' : 'text-stone-400'}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          <span className="text-xs font-bold">设置</span>
        </button>
      </nav>

      {/* Add Vaccine Modal */}
      {isVaccineModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 lg:p-6 border-b border-stone-100">
              <h2 className="text-lg lg:text-xl font-bold text-stone-800">新增兔瘟普免计划</h2>
              <p className="text-xs lg:text-sm text-stone-500 mt-1">设置首次免疫时间，系统将自动按每84天生成后续任务。</p>
            </div>
            <form onSubmit={handleAddVaccine} className="p-5 lg:p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">免疫日期</label>
                <input 
                  type="date" 
                  required
                  value={vaccineStartDate}
                  onChange={(e) => setVaccineStartDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-stone-300 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all"
                />
              </div>
              
              <div className="bg-cyan-50 border border-cyan-100 rounded-lg p-3 lg:p-4 mt-4 lg:mt-6">
                <h4 className="text-xs lg:text-sm font-medium text-cyan-800 mb-1 lg:mb-2">免疫计划说明：</h4>
                <ul className="text-[10px] lg:text-xs text-cyan-700 space-y-1 list-disc list-inside">
                  <li>将生成连续 20 次的免疫注射任务</li>
                  <li>每次任务间隔 84 天</li>
                  <li>在日历中以蓝绿色标签显示</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsVaccineModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-stone-300 text-stone-700 rounded-lg font-medium hover:bg-stone-50 transition-colors text-sm lg:text-base"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className={`flex-1 px-4 py-2.5 bg-cyan-600 text-white rounded-lg font-medium hover:bg-cyan-700 transition-colors shadow-sm text-sm lg:text-base ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isSubmitting ? '生成中...' : '生成计划'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Batch Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden my-auto animate-in fade-in zoom-in duration-200">
            <div className="p-5 lg:p-6 border-b border-stone-100">
              <h2 className="text-lg lg:text-xl font-bold text-stone-800">新增繁育批次</h2>
              <p className="text-xs lg:text-sm text-stone-500 mt-1">输入配种日期，系统将自动生成完整的繁育日程表。</p>
            </div>
            <form onSubmit={handleAddBatch} className="p-5 lg:p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">批次名称</label>
                <input 
                  type="text" 
                  required
                  value={newBatchName}
                  onChange={(e) => setNewBatchName(e.target.value)}
                  placeholder="例如：A区1栋 或 母兔001"
                  className="w-full px-4 py-2.5 rounded-lg border border-stone-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-700 mb-1">配种日期</label>
                <input 
                  type="date" 
                  required
                  value={newBatchDate}
                  onChange={(e) => setNewBatchDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-stone-300 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 lg:p-4 mt-4 lg:mt-6 max-h-[30vh] overflow-y-auto">
                <h4 className="text-xs lg:text-sm font-medium text-emerald-800 mb-1 lg:mb-2">42天模式将自动生成以下日程：</h4>
                <ul className="text-[10px] lg:text-xs text-emerald-700 space-y-1 list-disc list-inside">
                  <li>每次配种前 2 天：单只不带仔母兔注射氯前列醇钠0.5ml、带仔未怀孕母兔分窝补光</li>
                  <li>配种前 6 天至配种前 1 天：公兔饲喂月子餐20g</li>
                  <li>配种前 6 天至配种后 2 天：加光催情6-22点（第1-9天）</li>
                  <li>配种后第3天：加光6-17点（第10天）</li>
                  <li>产前 7 天（第24天）：母兔打头孢喹肟</li>
                  <li>孕 24 天至仔兔 3 日龄：母兔饲喂月子餐20g</li>
                  <li>第 26 天：放产箱</li>
                  <li>第 27 天：打开产箱门</li>
                  <li>第 29 天：补刨花垫草</li>
                  <li>第 30 天：小产日</li>
                  <li>第 31 天：大产日（仔兔1日龄）</li>
                  <li>第 32 天：催产日、母兔产后消炎、仔兔2日龄匀崽</li>
                  <li>仔兔 4-6 日龄：母兔月子餐每日增加5g（25g-35g）</li>
                  <li>仔兔 5 日龄：匀崽</li>
                  <li>仔兔 6-11 日龄：公兔饲喂月子餐20g</li>
                  <li>仔兔 6-14 日龄：加光催情6-22点（第1-9天）</li>
                  <li>仔兔 15 日龄：加光6-17点（第10天）</li>
                  <li>仔兔 7-17 日龄：母兔饲喂月子餐40g</li>
                  <li>仔兔 10 日龄：匀崽</li>
                  <li>仔兔 12 日龄（第42天）：再次配种</li>
                  <li>开产箱门前1天：匀崽</li>
                  <li>仔兔 16-19 日龄：开产箱门（视季节而定）</li>
                  <li>仔兔 18-25 日龄：母兔饲喂月子餐60g</li>
                  <li>仔兔 23 日龄（第53天）：撤产箱挡板</li>
                  <li>仔兔 28 日龄（第58天）：撤产箱</li>
                  <li>仔兔 30 日龄（第60天）：兔瘟免疫</li>
                  <li>仔兔 35 日龄（第65天）：分窝</li>
                  <li>仔兔 35-37 日龄：分窝起连续3天呼吸道预防投药</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-stone-300 text-stone-700 rounded-lg font-medium hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className={`flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors shadow-sm flex items-center justify-center gap-2 ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>正在生成...</span>
                    </>
                  ) : '生成日程'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Delete Batch Confirmation Modal */}
      {isDeleteModalOpen && batchToDelete && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
              </div>
              <h3 className="text-lg font-bold text-stone-800 mb-2">确认删除批次？</h3>
              <p className="text-sm text-stone-500 mb-6">
                确定要删除“<span className="font-semibold text-stone-700">{batchToDelete.name}</span>”及相关的所有任务吗？此操作不可撤销。
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    setIsDeleteModalOpen(false);
                    setBatchToDelete(null);
                  }}
                  className="flex-1 px-4 py-2.5 border border-stone-200 text-stone-600 rounded-lg font-medium hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={confirmDeleteBatch}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import Data Confirmation Modal */}
      {isImportModalOpen && importPendingData && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              </div>
              <h3 className="text-lg font-bold text-stone-800 mb-2">确认导入数据？</h3>
              <p className="text-sm text-stone-500 mb-6">
                导入将覆盖当前所有数据（包括 {importPendingData.batches.length} 个批次和 {importPendingData.tasks.length} 个任务）。确定继续吗？
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setImportPendingData(null);
                  }}
                  className="flex-1 px-4 py-2.5 border border-stone-200 text-stone-600 rounded-lg font-medium hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={confirmImportData}
                  className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors shadow-sm"
                >
                  确认覆盖
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Exit Confirmation Modal */}
      {isExitModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 lg:p-6">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-4 mx-auto">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
              </div>
              <h3 className="text-lg font-bold text-stone-800 mb-2 text-center">确认退出程序？</h3>
              <p className="text-sm text-stone-500 mb-6 text-center">
                您确定要退出当前程序吗？
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    setIsExitModalOpen(false);
                    history.pushState({ page: 'calendar', appInitialized: true }, '', '');
                  }}
                  className="flex-1 px-4 py-2.5 border border-stone-200 text-stone-600 rounded-lg font-medium hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={() => {
                    setIsExitModalOpen(false);
                    history.back();
                  }}
                  className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors shadow-sm"
                >
                  确认退出
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
