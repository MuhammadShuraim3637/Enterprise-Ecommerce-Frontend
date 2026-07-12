'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'no-token'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(`${API_URL}/auth/verify-email?token=${encodeURIComponent(token)}`);
        
        if (!res.ok) {
          let message = 'Verification failed';
          try {
            const body = await res.json();
            message = body?.detail || message;
          } catch {
            // no body
          }
          throw new Error(message);
        }

        setStatus('success');
      } catch (err: any) {
        setErrorMessage(err.message || 'Something went wrong. The link may have expired or is invalid.');
        setStatus('error');
      }
    };

    verify();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 font-mono text-xl font-bold text-teal-400">
            α
          </div>
          <h2 className="mt-6 text-2xl font-bold tracking-tight text-slate-800">
            Account Verification
          </h2>
          <p className="mt-1 font-mono text-[10px] text-slate-400">enterprise-ecommerce</p>
        </div>

        <div className="mt-8 space-y-6">
          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center space-y-4 py-6">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-600"></div>
              <p className="text-sm font-medium text-slate-500">Verifying your email address...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-medium text-slate-800">Email Verified!</h3>
                <p className="text-sm text-slate-500">
                  Your account has been successfully verified. You can now log in and explore the console.
                </p>
              </div>
              <button
                onClick={() => router.push('/')}
                className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                Go to Dashboard / Login
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-medium text-slate-800">Verification Failed</h3>
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-md p-3 font-mono text-xs">
                  {errorMessage}
                </p>
              </div>
              <button
                onClick={() => router.push('/')}
                className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                Back to Authentication
              </button>
            </div>
          )}

          {status === 'no-token' && (
            <div className="space-y-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-medium text-slate-800">Missing Token</h3>
                <p className="text-sm text-slate-500">
                  No verification token was found in the URL. Please click the verification link sent to your email.
                </p>
              </div>
              <button
                onClick={() => router.push('/')}
                className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
              >
                Back to Authentication
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
