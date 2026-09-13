'use client';
// Auto-refresh the dashboard while a publish is in flight.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Refresher({ active }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
