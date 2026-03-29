import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { categoriesApi, expensesApi } from '../api';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

export default function SubmitExpense() {
  const { company } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrPayload, setOcrPayload] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    amount: '',
    currency_code: company?.currency_code || 'USD',
    category_id: '',
    expense_date: new Date().toISOString().slice(0, 10),
  });
  const [file, setFile] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await categoriesApi.list();
        setCategories(data);
      } catch {
        toast.error('Could not load categories');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (company?.currency_code) {
      setForm((f) => ({ ...f, currency_code: company.currency_code }));
    }
  }, [company?.currency_code]);

  const runOcr = async () => {
    if (!file) {
      toast.error('Choose a receipt image first');
      return;
    }
    setOcrBusy(true);
    try {
      const fd = new FormData();
      fd.append('receipt', file);
      const { data } = await expensesApi.ocr(fd);
      setOcrPayload(data);
      setForm((f) => ({
        ...f,
        amount: data.amount != null ? String(data.amount) : f.amount,
        expense_date: data.date || f.expense_date,
        title: data.vendor?.trim() ? data.vendor.trim() : f.title,
        category_id: data.suggested_category_id || f.category_id,
        currency_code: data.suggested_currency_code || f.currency_code,
      }));
      if (data.ai_refined) {
        toast.success('OCR + AI review applied — please verify before submit');
      } else if (data.ocr_ai_error === 'insufficient_quota') {
        toast.error(
          'AI provider quota/billing issue — used local OCR only. Check your OpenAI or Groq account. Verify title and date.'
        );
      } else if (data.ocr_ai_error && data.ocr_ai_error !== 'invalid_response') {
        toast.error('AI receipt review failed — local OCR only. Please verify all fields.');
      } else {
        toast.success('OCR suggestions applied — review before submit');
      }
    } catch {
      toast.error('OCR failed');
    } finally {
      setOcrBusy(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('description', form.description);
      fd.append('amount', form.amount);
      fd.append('currency_code', form.currency_code);
      fd.append('expense_date', form.expense_date);
      if (form.category_id) fd.append('category_id', form.category_id);
      if (file) fd.append('receipt', file);
      if (ocrPayload) fd.append('ocr_payload', JSON.stringify(ocrPayload));
      const { data } = await expensesApi.submit(fd);
      toast.success('Expense submitted');
      navigate(`/expenses/${data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1 className="page-title">Submit expense</h1>
      <form onSubmit={onSubmit} className="form-stack form-max">
        <label>
          Title
          <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
        </label>
        <label>
          Amount
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            required
          />
        </label>
        <div className="form-row">
          <label>
            Currency
            <input
              value={form.currency_code}
              onChange={(e) => setForm((f) => ({ ...f, currency_code: e.target.value.toUpperCase() }))}
              required
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={form.expense_date}
              onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
              required
            />
          </label>
        </div>
        <label>
          Category
          <select value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.gst_applicable ? ' (GST)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
        <label>
          Receipt image
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={runOcr} disabled={ocrBusy || !file}>
            {ocrBusy ? 'Reading receipt…' : 'Run OCR'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  );
}
