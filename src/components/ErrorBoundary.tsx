import React, { Component, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error } as any;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if ((this.state as any).hasError) {
      const error = (this.state as any).error;
      return (
        <div className="min-h-screen bg-[#fdfbf7] flex items-center justify-center p-6" translate="no">
          <div className="glass-card p-8 w-full max-w-md text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center text-red-600 mx-auto">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-bold text-stone-800">申し訳ありません</h2>
            <div className="space-y-2">
              <p className="text-sm text-stone-500">
                アプリケーションで予期しないエラーが発生しました。
              </p>
              {error && (
                <div className="p-3 bg-red-50 rounded-xl text-left">
                  <p className="text-[10px] font-mono text-red-800 break-all">
                    {error.name}: {error.message}
                  </p>
                </div>
              )}
              <p className="text-xs text-stone-400">
                再読み込みをお試しください。
              </p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold text-sm hover:bg-emerald-700 transition-all"
            >
              ページを再読み込み
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default ErrorBoundary;
