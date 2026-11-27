use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use super::shared::{bump_counter, validate_new_hold};
use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::HoldCreated;
use crate::state::{Config, Hold, SubjectStats};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateHold<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: any address can be paid; it is only stored and used as a seed.
    #[account(constraint = recipient.key() != sender.key() @ HoldbackError::SelfTransfer)]
    pub recipient: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = sender,
        token::token_program = token_program,
    )]
    pub sender_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = sender,
        space = 8 + Hold::INIT_SPACE,
        seeds = [HOLD_SEED, sender.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub hold: Box<Account<'info, Hold>>,

    #[account(
        init,
        payer = sender,
        associated_token::mint = mint,
        associated_token::authority = hold,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + SubjectStats::INIT_SPACE,
        seeds = [STATS_SEED, recipient.key().as_ref()],
        bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn create_token(
    ctx: Context<CreateHold>,
    nonce: u64,
    amount: u64,
    window_secs: u32,
    tier: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    let (now, release_at) =
        validate_new_hold(config, amount, window_secs, config.min_window_secs, tier)?;

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.sender_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    // A fee-on-transfer mint would leave the vault short of `amount` and its
    // withheld fees would block closing the vault later. Refuse it up front.
    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount == amount,
        HoldbackError::UnsupportedMint
    );

    let hold = &mut ctx.accounts.hold;
    hold.sender = ctx.accounts.sender.key();
    hold.recipient = ctx.accounts.recipient.key();
    hold.mint = ctx.accounts.mint.key();
    hold.amount = amount;
    hold.created_at = now;
    hold.release_at = release_at;
    hold.tier = tier;
    hold.evidence_hash = evidence_hash;
    hold.origin = origin::WALLET;
    hold.status = status::PENDING;
    hold.rent_payer = ctx.accounts.sender.key();
    hold.nonce = nonce;
    hold.bump = ctx.bumps.hold;

    let stats = &mut ctx.accounts.recipient_stats;
    stats.touch(hold.recipient, ctx.bumps.recipient_stats);
    stats.holds_received = bump_counter(stats.holds_received)?;

    emit!(HoldCreated {
        hold: hold.key(),
        sender: hold.sender,
        recipient: hold.recipient,
        mint: hold.mint,
        amount,
        created_at: now,
        release_at,
        tier,
        origin: hold.origin,
        evidence_hash,
        nonce,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateHoldSol<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: any address can be paid; it is only stored and used as a seed.
    #[account(constraint = recipient.key() != sender.key() @ HoldbackError::SelfTransfer)]
    pub recipient: UncheckedAccount<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = sender,
        space = 8 + Hold::INIT_SPACE,
        seeds = [HOLD_SEED, sender.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub hold: Box<Account<'info, Hold>>,

    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + SubjectStats::INIT_SPACE,
        seeds = [STATS_SEED, recipient.key().as_ref()],
        bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,

    pub system_program: Program<'info, System>,
}

pub fn create_sol(
    ctx: Context<CreateHoldSol>,
    nonce: u64,
    amount: u64,
    window_secs: u32,
    tier: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    let (now, release_at) =
        validate_new_hold(config, amount, window_secs, config.min_window_secs, tier)?;

    // The payout must be able to stand on its own as a rent-exempt system
    // account, otherwise a release to a brand-new recipient would fail and
    // strand the funds until the sender notices.
    require!(
        amount >= Rent::get()?.minimum_balance(0),
        HoldbackError::AmountBelowRentFloor
    );

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.hold.to_account_info(),
            },
        ),
        amount,
    )?;

    let hold = &mut ctx.accounts.hold;
    hold.sender = ctx.accounts.sender.key();
    hold.recipient = ctx.accounts.recipient.key();
    hold.mint = NATIVE_SOL_MINT;
    hold.amount = amount;
    hold.created_at = now;
    hold.release_at = release_at;
    hold.tier = tier;
    hold.evidence_hash = evidence_hash;
    hold.origin = origin::WALLET;
    hold.status = status::PENDING;
    hold.rent_payer = ctx.accounts.sender.key();
    hold.nonce = nonce;
    hold.bump = ctx.bumps.hold;

    let stats = &mut ctx.accounts.recipient_stats;
    stats.touch(hold.recipient, ctx.bumps.recipient_stats);
    stats.holds_received = bump_counter(stats.holds_received)?;

    emit!(HoldCreated {
        hold: hold.key(),
        sender: hold.sender,
        recipient: hold.recipient,
        mint: hold.mint,
        amount,
        created_at: now,
        release_at,
        tier,
        origin: hold.origin,
        evidence_hash,
        nonce,
    });
    Ok(())
}
