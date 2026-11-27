use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use super::shared::{bump_counter, validate_new_hold};
use crate::constants::*;
use crate::errors::HoldbackError;
use crate::events::{DepositBoxOpened, DepositWithdrawn, HoldCreated};
use crate::state::{Config, DepositBox, Hold, SubjectStats};

#[derive(Accounts)]
pub struct InitDepositBox<'info> {
    /// The owner or the relayer; whoever pays the rent.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: the wallet the box belongs to. It only seeds the PDA; creating
    /// a box for someone grants the creator nothing.
    pub owner: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + DepositBox::INIT_SPACE,
        seeds = [BOX_SEED, owner.key().as_ref()],
        bump,
    )]
    pub deposit_box: Box<Account<'info, DepositBox>>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = deposit_box,
        associated_token::token_program = token_program,
    )]
    pub box_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_box(ctx: Context<InitDepositBox>) -> Result<()> {
    let deposit_box = &mut ctx.accounts.deposit_box;
    deposit_box.owner = ctx.accounts.owner.key();
    deposit_box.bump = ctx.bumps.deposit_box;

    emit!(DepositBoxOpened {
        deposit_box: deposit_box.key(),
        owner: deposit_box.owner,
        mint: ctx.accounts.mint.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct OpenHoldFromDeposit<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = relayer @ HoldbackError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    /// The hold's sender is read from here, never from instruction data.
    #[account(
        seeds = [BOX_SEED, deposit_box.owner.as_ref()],
        bump = deposit_box.bump,
    )]
    pub deposit_box: Box<Account<'info, DepositBox>>,

    /// CHECK: any address can be paid; it is only stored and used as a seed.
    #[account(constraint = recipient.key() != deposit_box.owner @ HoldbackError::SelfTransfer)]
    pub recipient: UncheckedAccount<'info>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deposit_box,
        associated_token::token_program = token_program,
    )]
    pub box_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = relayer,
        space = 8 + Hold::INIT_SPACE,
        seeds = [HOLD_SEED, deposit_box.owner.as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub hold: Box<Account<'info, Hold>>,

    #[account(
        init,
        payer = relayer,
        associated_token::mint = mint,
        associated_token::authority = hold,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = relayer,
        space = 8 + SubjectStats::INIT_SPACE,
        seeds = [STATS_SEED, recipient.key().as_ref()],
        bump,
    )]
    pub recipient_stats: Box<Account<'info, SubjectStats>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn open_hold_from_box(
    ctx: Context<OpenHoldFromDeposit>,
    nonce: u64,
    amount: u64,
    window_secs: u32,
    tier: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    // Relayer-opened holds can never be shorter than the default window. A
    // stolen relayer key therefore cannot pay anyone in less than that time,
    // during which the owner can undo and the admin can rotate the key.
    let (now, release_at) = validate_new_hold(
        config,
        amount,
        window_secs,
        config.default_window_secs.max(config.min_window_secs),
        tier,
    )?;

    let owner = ctx.accounts.deposit_box.owner;
    let box_bump = [ctx.accounts.deposit_box.bump];
    let seeds: &[&[u8]] = &[BOX_SEED, owner.as_ref(), &box_bump];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.box_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.deposit_box.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    ctx.accounts.vault.reload()?;
    require!(
        ctx.accounts.vault.amount == amount,
        HoldbackError::UnsupportedMint
    );

    let hold = &mut ctx.accounts.hold;
    hold.sender = owner;
    hold.recipient = ctx.accounts.recipient.key();
    hold.mint = ctx.accounts.mint.key();
    hold.amount = amount;
    hold.created_at = now;
    hold.release_at = release_at;
    hold.tier = tier;
    hold.evidence_hash = evidence_hash;
    hold.origin = origin::DEPOSIT_BOX;
    hold.status = status::PENDING;
    hold.rent_payer = ctx.accounts.relayer.key();
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
pub struct WithdrawDeposit<'info> {
    /// The box owner, or the relayer acting for them.
    pub authority: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [BOX_SEED, deposit_box.owner.as_ref()],
        bump = deposit_box.bump,
        constraint = authority.key() == deposit_box.owner
            || authority.key() == config.relayer @ HoldbackError::Unauthorized,
    )]
    pub deposit_box: Box<Account<'info, DepositBox>>,

    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = deposit_box,
        associated_token::token_program = token_program,
    )]
    pub box_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Whoever signs, the money can only land in a token account owned by
    /// the box owner.
    #[account(
        mut,
        token::mint = mint,
        token::authority = deposit_box.owner,
        token::token_program = token_program,
    )]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_from_box(ctx: Context<WithdrawDeposit>, amount: u64) -> Result<()> {
    require!(amount > 0, HoldbackError::ZeroAmount);

    let owner = ctx.accounts.deposit_box.owner;
    let box_bump = [ctx.accounts.deposit_box.bump];
    let seeds: &[&[u8]] = &[BOX_SEED, owner.as_ref(), &box_bump];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.box_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.owner_token.to_account_info(),
                authority: ctx.accounts.deposit_box.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    emit!(DepositWithdrawn {
        deposit_box: ctx.accounts.deposit_box.key(),
        owner,
        mint: ctx.accounts.mint.key(),
        amount,
        timestamp: Clock::get()?.unix_timestamp,
        by: ctx.accounts.authority.key(),
    });
    Ok(())
}
