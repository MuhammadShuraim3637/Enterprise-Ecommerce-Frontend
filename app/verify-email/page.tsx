'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8000/api/v1';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<
    'loading' | 'success' | 'error' | 'no-token'
  >('loading');

  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(
          `${API_URL}/auth/verify-email?token=${encodeURIComponent(token)}`
        );

        if (!res.ok) {
          let message = 'Verification failed';

          try {
            const body = await res.json();
            message = body?.detail || message;
          } catch {}

          throw new Error(message);
        }

        setStatus('success');
      } catch (err: any) {
        setErrorMessage(
          err.message ||
            'Something went wrong. The link may have expired or is invalid.'
        );
        setStatus('error');
      }
    };

    verify();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">

        <div className="text-center">
          <div className="text-3xl font-bold text-teal-600">α</div>
          <h1 className="mt-2 text-2xl font-bold">Account Verification</h1>
          <p className="text-slate-500">enterprise-ecommerce</p>
        </div>

        <div className="mt-8 space-y-6">

          {status === 'loading' && (
            <div className="flex flex-col items-center space-y-4 py-6">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-600"></div>
              <p>Verifying your email address...</p>
            </div>
          )}

          {status === 'success' && (
            <div className="text-center space-y-4">
              <h2 className="text-xl font-semibold text-green-600">
                Email Verified!
              </h2>

              <button
                onClick={() => router.push('/')}
                className="w-full rounded bg-slate-900 py-2 text-white hover:bg-teal-700"
              >
                Go to Dashboard / Login
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center space-y-4">
              <h2 className="text-xl font-semibold text-red-600">
                Verification Failed
              </h2>

              <p className="rounded bg-red-50 p-3 text-sm text-red-600">
                {errorMessage}
              </p>

              <button
                onClick={() => router.push('/')}
                className="w-full rounded border py-2"
              >
                Back to Authentication
              </button>
            </div>
          )}

          {status === 'no-token' && (
            <div className="text-center space-y-4">
              <h2 className="text-xl font-semibold text-yellow-600">
                Missing Token
              </h2>

              <p>
                No verification token was found in the URL.
              </p>

              <button
                onClick={() => router.push('/')}
                className="w-full rounded bg-slate-900 py-2 text-white"
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

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}