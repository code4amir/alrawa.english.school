import { describe, it, expect } from 'vitest';
import {
  createTransactionSchema,
  createStudentSchema,
  createClassSchema,
  categorySchema,
  loginSchema,
  registerSchema,
  feeScheduleSchema,
  openingBalancesSchema,
} from '../lib/validation';

describe('createTransactionSchema', () => {
  const validIncome = {
    date: '2026-06-01',
    amount: 5000,
    type: 'INCOME' as const,
    category: 'Tuition Fee',
    description: 'June fee',
    feeMonth: '2026-06',
    destinationAccount: 'CASH_IN_HAND',
  };

  const validExpense = {
    date: '2026-06-01',
    amount: 2000,
    type: 'EXPENSE' as const,
    category: 'Stationery',
    description: 'Pencils',
    sourceAccount: 'CASH_IN_HAND',
  };

  const validTransfer = {
    date: '2026-06-01',
    amount: 10000,
    type: 'INTERNAL_TRANSFER' as const,
    sourceAccount: 'CASH_IN_HAND',
    destinationAccount: 'AL_RAWA_BANK',
    description: 'Transfer to bank',
  };

  it('accepts valid income', () => {
    const result = createTransactionSchema.safeParse(validIncome);
    expect(result.success).toBe(true);
  });

  it('accepts valid expense', () => {
    const result = createTransactionSchema.safeParse(validExpense);
    expect(result.success).toBe(true);
  });

  it('accepts valid transfer', () => {
    const result = createTransactionSchema.safeParse(validTransfer);
    expect(result.success).toBe(true);
  });

  it('rejects missing date', () => {
    const result = createTransactionSchema.safeParse({ ...validIncome, date: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('date'))).toBe(true);
    }
  });

  it('rejects negative amount', () => {
    const result = createTransactionSchema.safeParse({ ...validIncome, amount: -100 });
    expect(result.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const result = createTransactionSchema.safeParse({ ...validIncome, amount: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects same-account transfer', () => {
    const result = createTransactionSchema.safeParse({
      ...validTransfer,
      sourceAccount: 'CASH_IN_HAND',
      destinationAccount: 'CASH_IN_HAND',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid account', () => {
    const result = createTransactionSchema.safeParse({
      ...validExpense,
      sourceAccount: 'INVALID_ACCOUNT',
    });
    expect(result.success).toBe(true);
  });
});

describe('createStudentSchema', () => {
  it('accepts valid student', () => {
    const result = createStudentSchema.safeParse({ name: 'John Doe', classId: 'class-1' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createStudentSchema.safeParse({ name: '', classId: 'class-1' });
    expect(result.success).toBe(false);
  });

  it('rejects empty classId', () => {
    const result = createStudentSchema.safeParse({ name: 'John', classId: '' });
    expect(result.success).toBe(false);
  });

  it('accepts optional fields', () => {
    const result = createStudentSchema.safeParse({
      name: 'John',
      classId: 'c1',
      roll: '10',
      fatherName: 'Mr. Doe',
      motherName: 'Mrs. Doe',
      contact: '0123456789',
    });
    expect(result.success).toBe(true);
  });
});

describe('createClassSchema', () => {
  it('accepts valid class name', () => {
    const result = createClassSchema.safeParse({ name: 'Class 5' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createClassSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });
});

describe('categorySchema', () => {
  it('accepts valid income category', () => {
    const result = categorySchema.safeParse({ name: 'Tuition Fee', type: 'INCOME' });
    expect(result.success).toBe(true);
  });

  it('accepts valid expense category', () => {
    const result = categorySchema.safeParse({ name: 'Stationery', type: 'EXPENSE' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = categorySchema.safeParse({ name: '', type: 'INCOME' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = categorySchema.safeParse({ name: 'Test', type: 'OTHER' });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts valid login', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'Password1' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({ email: 'not-email', password: '123456' });
    expect(result.success).toBe(false);
  });

  it('rejects short password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '123' });
    expect(result.success).toBe(false);
  });
});

describe('registerSchema', () => {
  it('accepts valid registration', () => {
    const result = registerSchema.safeParse({ name: 'Test', email: 'a@b.com', password: 'Password1' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = registerSchema.safeParse({ name: '', email: 'a@b.com', password: '123456' });
    expect(result.success).toBe(false);
  });
});

describe('feeScheduleSchema', () => {
  it('accepts valid monthly fee', () => {
    const result = feeScheduleSchema.safeParse({ category: 'Tuition', amount: 5000, frequency: 'MONTHLY' });
    expect(result.success).toBe(true);
  });

  it('rejects negative amount', () => {
    const result = feeScheduleSchema.safeParse({ category: 'Tuition', amount: -100, frequency: 'MONTHLY' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid frequency', () => {
    const result = feeScheduleSchema.safeParse({ category: 'Tuition', amount: 5000, frequency: 'DAILY' });
    expect(result.success).toBe(false);
  });
});

describe('openingBalancesSchema', () => {
  it('accepts valid balances', () => {
    const result = openingBalancesSchema.safeParse({
      AL_RAWA_BANK: 10000,
      GLOBAL_FORUM_BANK: 5000,
      CASH_IN_HAND: 2000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative balance', () => {
    const result = openingBalancesSchema.safeParse({
      AL_RAWA_BANK: -100,
      GLOBAL_FORUM_BANK: 0,
      CASH_IN_HAND: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts zero balances', () => {
    const result = openingBalancesSchema.safeParse({
      AL_RAWA_BANK: 0,
      GLOBAL_FORUM_BANK: 0,
      CASH_IN_HAND: 0,
    });
    expect(result.success).toBe(true);
  });
});
