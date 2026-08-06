import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import ParentLayout from './ParentLayout';
import { ChevronLeft, Wallet, Receipt, Download } from 'lucide-react';
import { pdfPaymentReceipt } from '../../lib/parentReceiptPdf';
import type { ParentPayment } from '../../lib/parentReceiptPdf';

interface FeeSchedule {
  category: string;
  amount: string;
  frequency: string;
  assigned: boolean;
}

interface FeeStatus {
  totalDue: string;
  totalPaid: string;
  balance: string;
  schedules: FeeSchedule[];
}

interface PaymentStudent {
  id: string;
  name: string;
  className: string;
}

export default function ParentFees() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<FeeStatus | null>(null);
  const [payments, setPayments] = useState<ParentPayment[]>([]);
  const [studentInfo, setStudentInfo] = useState<PaymentStudent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    api.get(`/parents/fees/${studentId}/`)
      .then((res) => setData(res.data))
      .catch(() => toast('Failed to load fee status', 'error'))
      .finally(() => setLoading(false));
    api.get(`/parents/payments/${studentId}/`)
      .then((res) => setPayments(res.data || []))
      .catch(() => { /* payment history optional */ });
    api.get('/parents/my-students/')
      .then((res) => {
        const s = (res.data || []).find((x: PaymentStudent) => x.id === studentId);
        if (s) setStudentInfo(s);
      })
      .catch(() => { /* student info optional */ });
  }, [studentId]);

  const balance = data ? parseFloat(data.balance) : 0;
  const activePayments = payments.filter((p) => !p.isCancelled);
  const totalCollected = activePayments.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <ParentLayout>
      <Toast />
      {!studentId ? (
        <StudentSelector onSelect={(id) => navigate(`/parent/fees/${id}`)} />
      ) : (
        <>
          <button onClick={() => navigate('/parent')} className="flex items-center gap-1 text-sm text-school-muted mb-3 hover:text-school-primary">
            <ChevronLeft size={16} />
            Back to Dashboard
          </button>

          {loading ? (
            <div className="animate-pulse bg-white rounded-xl p-6 border border-school-border">
              <div className="h-6 bg-gray-200 rounded w-1/2 mb-4" />
              <div className="h-10 bg-gray-100 rounded mb-3" />
              <div className="h-4 bg-gray-100 rounded w-3/4" />
            </div>
          ) : data ? (
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl p-5 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <Wallet size={24} />
                  <h2 className="font-serif text-lg">Fee Status</h2>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div>
                    <p className="text-xs text-white/70">Total Due</p>
                    <p className="text-xl font-bold">${parseFloat(data.totalDue).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/70">Total Paid</p>
                    <p className="text-xl font-bold">${parseFloat(data.totalPaid).toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/70">Balance</p>
                    <p className={`text-xl font-bold ${balance > 0 ? 'text-red-200' : 'text-green-200'}`}>
                      ${balance.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {data.schedules.length > 0 && (
                <div className="bg-white rounded-xl border border-school-border overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-school-border">
                    <h3 className="font-bold text-sm text-school-primary">Fee Breakdown</h3>
                  </div>
                  {data.schedules.map((s, i) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between border-b border-school-border last:border-0">
                      <div>
                        <p className="font-semibold text-sm text-school-primary">{s.category}</p>
                        <p className="text-[11px] text-school-muted">{s.frequency}</p>
                      </div>
                      <span className="font-bold text-school-primary">${parseFloat(s.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white rounded-xl border border-school-border overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-school-border flex items-center justify-between">
                  <h3 className="font-bold text-sm text-school-primary flex items-center gap-2">
                    <Receipt size={15} /> Payment History
                  </h3>
                  {activePayments.length > 0 && (
                    <span className="text-xs text-school-muted">
                      Total collected: <b>${totalCollected.toFixed(2)}</b>
                    </span>
                  )}
                </div>
                {activePayments.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-school-muted">No payments recorded yet.</p>
                ) : (
                  activePayments.map((p, i) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between border-b border-school-border last:border-0">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-school-primary truncate">{p.category}</p>
                        <p className="text-[11px] text-school-muted">
                          {p.reference} · {p.date} · {p.method}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-bold text-emerald-600">${Number(p.amount).toFixed(2)}</span>
                        <button
                          onClick={() => studentInfo && pdfPaymentReceipt(p, { name: studentInfo.name, className: studentInfo.className })}
                          className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 hover:bg-amber-100 transition-colors"
                        >
                          <Download size={12} /> Receipt
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl p-6 text-center text-school-muted border border-school-border">
              No fee data available
            </div>
          )}
        </>
      )}
    </ParentLayout>
  );
}

function StudentSelector({ onSelect }: { onSelect: (id: string) => void }) {
  const [students, setStudents] = useState<Array<{ id: string; name: string; className: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/my-students/')
      .then((res) => setStudents(res.data))
      .catch(() => toast('Failed to load students', 'error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3">
      <h2 className="font-serif text-lg text-school-primary">Select a student</h2>
      {loading ? (
        <div className="text-school-muted">Loading...</div>
      ) : (
        students.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="w-full bg-white rounded-xl border border-school-border p-4 text-left card-shadow hover:shadow-md transition-shadow"
          >
            <p className="font-bold text-school-primary">{s.name}</p>
            <p className="text-xs text-school-muted">{s.className}</p>
          </button>
        ))
      )}
    </div>
  );
}
