use anchor_lang::prelude::*;

declare_id!("FqvRWFBSiDmN3PBwCfs9YZAhh53goQF2YxYku2b8jVXo");

#[program]
pub mod sponsor_program {
    use super::*;

    /// Sponsor a new user's first transaction
    /// Transfers SOL from vault to user and records sponsorship
    pub fn sponsor_user(ctx: Context<SponsorUser>, amount: u64) -> Result<()> {
        let sponsored_user = &mut ctx.accounts.sponsored_user;
        let vault = &ctx.accounts.vault;
        let user = &ctx.accounts.user;

        // Check if user has already been sponsored
        require!(!sponsored_user.is_sponsored, SponsorError::AlreadySponsored);

        // Validate amount (max 0.01 SOL = 10,000,000 lamports)
        require!(amount <= 10_000_000, SponsorError::AmountTooLarge);

        // Transfer SOL from vault to user
        **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **user.to_account_info().try_borrow_mut_lamports()? += amount;

        // Mark as sponsored
        sponsored_user.is_sponsored = true;
        sponsored_user.sponsored_at = Clock::get()?.unix_timestamp;
        sponsored_user.amount = amount;

        msg!("Sponsored user {} with {} lamports", user.key(), amount);

        Ok(())
    }

    /// Initialize a sponsored user account (called before first sponsorship)
    pub fn initialize_sponsored_user(ctx: Context<InitializeSponsoredUser>) -> Result<()> {
        let sponsored_user = &mut ctx.accounts.sponsored_user;
        sponsored_user.user = ctx.accounts.user.key();
        sponsored_user.is_sponsored = false;
        sponsored_user.sponsored_at = 0;
        sponsored_user.amount = 0;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct SponsorUser<'info> {
    /// Sponsored user account (PDA)
    #[account(
        mut,
        seeds = [b"sponsored", user.key().as_ref()],
        bump,
        constraint = !sponsored_user.is_sponsored @ SponsorError::AlreadySponsored
    )]
    pub sponsored_user: Account<'info, SponsoredUserAccount>,

    /// Vault wallet (must be signer and have sufficient balance)
    #[account(mut)]
    pub vault: Signer<'info>,

    /// User being sponsored
    /// CHECK: User account that will receive SOL
    #[account(mut)]
    pub user: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeSponsoredUser<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 1 + 8 + 8, // discriminator + user pubkey + bool + timestamp + amount
        seeds = [b"sponsored", user.key().as_ref()],
        bump
    )]
    pub sponsored_user: Account<'info, SponsoredUserAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct SponsoredUserAccount {
    pub user: Pubkey,
    pub is_sponsored: bool,
    pub sponsored_at: i64,
    pub amount: u64,
}

#[error_code]
pub enum SponsorError {
    #[msg("User has already been sponsored")]
    AlreadySponsored,
    #[msg("Sponsorship amount is too large")]
    AmountTooLarge,
}

