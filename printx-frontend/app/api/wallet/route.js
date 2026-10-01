import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/* Server-side Supabase client — lib/supabaseClient is a 'use client'
 * browser client and throws "from is on the client" when called from a
 * route handler. Same pattern as /api/upload and /api/coupons/validate. */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;
const isSupabaseConfigured = Boolean(supabase);

/* ===================================================================== */
/* POST /api/wallet — Recharge wallet or check balance                    */
/* ===================================================================== */
export async function POST(request) {
  if (!isSupabaseConfigured || !supabase) {
    return NextResponse.json(
      { success: false, error: 'Wallet service not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { action, phone, amount, bonus } = body;

    /* ---- Check balance ---- */
    if (action === 'check_balance') {
      if (!phone || !/^[6-9]\d{9}$/.test(phone.replace(/\s/g, ''))) {
        return NextResponse.json(
          { success: false, error: 'Valid 10-digit phone number required' },
          { status: 400 }
        );
      }

      const cleanPhone = phone.replace(/\s/g, '');
      const { data, error } = await supabase
        .from('wallets')
        .select('id, phone, balance, created_at')
        .eq('phone', cleanPhone)
        .maybeSingle();

      if (error) {
        console.error('[wallet] check_balance error:', error.message);
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }

      if (!data) {
        // No wallet yet — lazily create a zero-balance row so the student's
        // wallet exists from first check (best-effort: recharge can create it).
        let created = null;
        try {
          const res = await supabase
            .from('wallets')
            .insert([{ phone: cleanPhone, balance: 0 }])
            .select('id')
            .maybeSingle();
          created = res.data;
        } catch (e) {
          console.warn('[wallet] lazy wallet create failed:', e.message);
        }
        return NextResponse.json({
          success: true,
          exists: Boolean(created),
          balance: 0,
          phone: cleanPhone,
        });
      }

      return NextResponse.json({
        success: true,
        exists: true,
        balance: Number(data.balance) || 0,
        phone: data.phone,
      });
    }

    /* ---- Recharge wallet ---- */
    if (action === 'recharge') {
      const cleanPhone = phone?.replace(/\s/g, '');
      if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
        return NextResponse.json(
          { success: false, error: 'Valid 10-digit phone number required' },
          { status: 400 }
        );
      }

      const rechargeAmount = Number(amount);
      const bonusAmount = Number(bonus) || 0;
      const totalCredit = rechargeAmount + bonusAmount;

      if (!rechargeAmount || rechargeAmount <= 0) {
        return NextResponse.json(
          { success: false, error: 'Invalid recharge amount' },
          { status: 400 }
        );
      }

      // Upsert wallet — create if not exists
      const { data: existing, error: fetchErr } = await supabase
        .from('wallets')
        .select('id, balance')
        .eq('phone', cleanPhone)
        .maybeSingle();

      if (fetchErr) {
        console.error('[wallet] fetch error:', fetchErr.message);
        return NextResponse.json(
          { success: false, error: fetchErr.message },
          { status: 500 }
        );
      }

      let walletId;
      let newBalance;

      if (existing) {
        // Update existing wallet
        newBalance = (Number(existing.balance) || 0) + totalCredit;
        const { error: updateErr } = await supabase
          .from('wallets')
          .update({
            balance: newBalance,
          })
          .eq('id', existing.id);

        if (updateErr) {
          console.error('[wallet] update error:', updateErr.message);
          return NextResponse.json(
            { success: false, error: updateErr.message },
            { status: 500 }
          );
        }
        walletId = existing.id;
      } else {
        // Create new wallet
        const { data: created, error: createErr } = await supabase
          .from('wallets')
          .insert([{
            phone: cleanPhone,
            balance: totalCredit,
          }])
          .select('id')
          .single();

        if (createErr) {
          console.error('[wallet] create error:', createErr.message);
          return NextResponse.json(
            { success: false, error: createErr.message },
            { status: 500 }
          );
        }
        walletId = created.id;
        newBalance = totalCredit;
      }

      // Log transaction — non-fatal: the balance is already credited, so a
      // failed log must NOT error the request (client would retry → double credit).
      const { error: logErr } = await supabase.from('wallet_transactions').insert([{
        wallet_id: walletId,
        type: 'recharge',
        amount: totalCredit,
        description: bonusAmount > 0
          ? `Recharged ₹${rechargeAmount} + ₹${bonusAmount} bonus`
          : `Recharged ₹${rechargeAmount}`,
      }]);
      if (logErr) console.error('[wallet] recharge transaction log failed:', logErr.message);

      return NextResponse.json({
        success: true,
        balance: newBalance,
        credited: totalCredit,
        phone: cleanPhone,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action. Use check_balance or recharge.' },
      { status: 400 }
    );
  } catch (err) {
    console.error('[wallet] POST error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/* ===================================================================== */
/* PUT /api/wallet — Deduct balance for payment                           */
/* ===================================================================== */
export async function PUT(request) {
  if (!isSupabaseConfigured || !supabase) {
    return NextResponse.json(
      { success: false, error: 'Wallet service not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { phone, amount, description } = body;

    if (!phone || !/^[6-9]\d{9}$/.test(phone.replace(/\s/g, ''))) {
      return NextResponse.json(
        { success: false, error: 'Valid 10-digit phone number required' },
        { status: 400 }
      );
    }

    const deductAmount = Number(amount);
    if (!deductAmount || deductAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid deduction amount' },
        { status: 400 }
      );
    }

    const cleanPhone = phone.replace(/\s/g, '');

    // Fetch current balance
    const { data: wallet, error: fetchErr } = await supabase
      .from('wallets')
      .select('id, balance')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (fetchErr) {
      console.error('[wallet] deduct fetch error:', fetchErr.message);
      return NextResponse.json(
        { success: false, error: fetchErr.message },
        { status: 500 }
      );
    }

    if (!wallet) {
      return NextResponse.json(
        { success: false, error: 'Wallet not found for this phone number' },
        { status: 404 }
      );
    }

    const currentBalance = Number(wallet.balance) || 0;

    if (currentBalance < deductAmount) {
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient balance. Available: ₹${currentBalance}, Required: ₹${deductAmount}`,
          balance: currentBalance,
        },
        { status: 400 }
      );
    }

    const newBalance = currentBalance - deductAmount;

    // Atomic-style deduct: the .gte() guard makes the UPDATE conditional on
    // the balance still covering the amount, so two concurrent debits can't
    // both succeed (prevents double-spend / negative balances).
    const { data: updatedRows, error: deductErr } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('id', wallet.id)
      .gte('balance', deductAmount)
      .select('id, balance');

    if (deductErr) {
      console.error('[wallet] deduct error:', deductErr.message);
      return NextResponse.json(
        { success: false, error: deductErr.message },
        { status: 500 }
      );
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Balance changed between read and write (or was already too low)
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient balance — please refresh and try again',
        },
        { status: 400 }
      );
    }

    // Log transaction — non-fatal (balance already deducted above)
    const { error: logErr } = await supabase.from('wallet_transactions').insert([{
      wallet_id: wallet.id,
      type: 'deduction',
      amount: -deductAmount,
      description: description || `Payment of ₹${deductAmount}`,
    }]);
    if (logErr) console.error('[wallet] deduction transaction log failed:', logErr.message);

    return NextResponse.json({
      success: true,
      balance: newBalance,
      deducted: deductAmount,
      phone: cleanPhone,
    });
  } catch (err) {
    console.error('[wallet] PUT error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
