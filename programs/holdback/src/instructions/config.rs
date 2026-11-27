use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::HoldbackError;
use crate::program::Holdback;
use crate::state::Config;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    /// Must be the program's upgrade authority, so nobody can front-run the
    /// deployer and install their own service keys.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        constraint = program.programdata_address()? == Some(program_data.key())
            @ HoldbackError::Unauthorized,
    )]
    pub program: Program<'info, Holdback>,

    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ HoldbackError::Unauthorized,
    )]
    pub program_data: Account<'info, ProgramData>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    relayer: Pubkey,
    risk_oracle: Pubkey,
    min_window_secs: u32,
    default_window_secs: u32,
    max_window_secs: u32,
) -> Result<()> {
    validate_windows(min_window_secs, default_window_secs, max_window_secs)?;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.relayer = relayer;
    config.risk_oracle = risk_oracle;
    config.min_window_secs = min_window_secs;
    config.default_window_secs = default_window_secs;
    config.max_window_secs = max_window_secs;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}

/// Fields left as `None` keep their current value.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct UpdateConfigArgs {
    pub admin: Option<Pubkey>,
    pub relayer: Option<Pubkey>,
    pub risk_oracle: Option<Pubkey>,
    pub min_window_secs: Option<u32>,
    pub default_window_secs: Option<u32>,
    pub max_window_secs: Option<u32>,
    pub paused: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ HoldbackError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
    let config = &mut ctx.accounts.config;

    let min = args.min_window_secs.unwrap_or(config.min_window_secs);
    let default = args
        .default_window_secs
        .unwrap_or(config.default_window_secs);
    let max = args.max_window_secs.unwrap_or(config.max_window_secs);
    validate_windows(min, default, max)?;

    config.min_window_secs = min;
    config.default_window_secs = default;
    config.max_window_secs = max;
    if let Some(admin) = args.admin {
        config.admin = admin;
    }
    if let Some(relayer) = args.relayer {
        config.relayer = relayer;
    }
    if let Some(risk_oracle) = args.risk_oracle {
        config.risk_oracle = risk_oracle;
    }
    if let Some(paused) = args.paused {
        config.paused = paused;
    }
    Ok(())
}

fn validate_windows(min: u32, default: u32, max: u32) -> Result<()> {
    require!(
        min <= default && default <= max && max <= WINDOW_HARD_CAP_SECS && max > 0,
        HoldbackError::InvalidWindowConfig
    );
    Ok(())
}
