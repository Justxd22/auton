use anchor_lang::prelude::*;

declare_id!("Afe5nZMYr8s63mbbrBCweydXsB4o45ztiKFAA5gmmPvm");

#[program]
pub mod vault_governance {
    use super::*;

    /// Initialize the vault with admin and parameters
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        fee_percentage: u64,
        sponsorship_amount: u64,
    ) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.vault_wallet = ctx.accounts.vault_wallet.key();
        vault_state.admin = ctx.accounts.admin.key();
        vault_state.fee_percentage = fee_percentage; // Basis points (10000 = 100%)
        vault_state.sponsorship_amount = sponsorship_amount;
        vault_state.total_collected = 0;
        vault_state.total_sponsored = 0;
        vault_state.is_initialized = true;

        msg!("Vault initialized with admin: {}", ctx.accounts.admin.key());

        Ok(())
    }

    /// Update the admin (requires current admin signature)
    pub fn update_admin(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        require!(
            vault_state.admin == ctx.accounts.admin.key(),
            VaultError::Unauthorized
        );

        vault_state.admin = new_admin;
        msg!("Admin updated to: {}", new_admin);

        Ok(())
    }

    /// Update the platform fee percentage
    pub fn update_fee_percentage(
        ctx: Context<UpdateFeePercentage>,
        new_fee_percentage: u64,
    ) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        require!(
            vault_state.admin == ctx.accounts.admin.key(),
            VaultError::Unauthorized
        );
        require!(new_fee_percentage <= 10000, VaultError::InvalidFee); // Max 100%

        vault_state.fee_percentage = new_fee_percentage;
        msg!("Fee percentage updated to: {} basis points", new_fee_percentage);

        Ok(())
    }

    /// Update the sponsorship amount
    pub fn update_sponsorship_amount(
        ctx: Context<UpdateSponsorshipAmount>,
        new_amount: u64,
    ) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        require!(
            vault_state.admin == ctx.accounts.admin.key(),
            VaultError::Unauthorized
        );
        require!(new_amount <= 10_000_000, VaultError::AmountTooLarge); // Max 0.01 SOL

        vault_state.sponsorship_amount = new_amount;
        msg!("Sponsorship amount updated to: {} lamports", new_amount);

        Ok(())
    }

    /// Collect platform fees from a transaction
    /// Called via CPI from the main Auton program
    pub fn collect_fees(ctx: Context<CollectFees>, amount: u64) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        let fee_amount = (amount * vault_state.fee_percentage) / 10000;

        // Transfer fee to vault wallet
        **ctx.accounts.payer.to_account_info().try_borrow_mut_lamports()? -= fee_amount;
        **ctx.accounts.vault_wallet.to_account_info().try_borrow_mut_lamports()? += fee_amount;

        vault_state.total_collected += fee_amount;

        msg!("Collected {} lamports in fees", fee_amount);

        Ok(())
    }

    /// Withdraw funds from vault (admin only, with limits)
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        recipient: Pubkey,
    ) -> Result<()> {
        let vault_state = &ctx.accounts.vault_state;
        require!(
            vault_state.admin == ctx.accounts.admin.key(),
            VaultError::Unauthorized
        );

        // Check minimum balance (keep at least 5 SOL for operations)
        let vault_balance = ctx.accounts.vault_wallet.lamports();
        require!(
            vault_balance.saturating_sub(amount) >= 5_000_000_000,
            VaultError::InsufficientBalance
        );

        // Transfer funds
        **ctx.accounts.vault_wallet.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;

        msg!("Withdrew {} lamports to {}", amount, recipient);

        Ok(())
    }

    /// Record a sponsorship (called by sponsor program)
    pub fn record_sponsorship(ctx: Context<RecordSponsorship>, amount: u64) -> Result<()> {
        let vault_state = &mut ctx.accounts.vault_state;
        vault_state.total_sponsored += amount;

        msg!("Recorded sponsorship of {} lamports", amount);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 1, // discriminator + vault_wallet + admin + fee_percentage + sponsorship_amount + total_collected + total_sponsored + is_initialized
        seeds = [b"vault_state"],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: Vault wallet address
    pub vault_wallet: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateFeePercentage<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateSponsorshipAmount<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: Payer of the transaction (from Auton program)
    #[account(mut)]
    pub payer: AccountInfo<'info>,

    /// CHECK: Vault wallet that receives fees
    #[account(mut)]
    pub vault_wallet: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,

    /// CHECK: Vault wallet
    #[account(mut)]
    pub vault_wallet: AccountInfo<'info>,

    /// CHECK: Recipient of withdrawal
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordSponsorship<'info> {
    #[account(mut)]
    pub vault_state: Account<'info, VaultState>,
}

#[account]
pub struct VaultState {
    pub vault_wallet: Pubkey,
    pub admin: Pubkey,
    pub fee_percentage: u64, // Basis points (10000 = 100%)
    pub sponsorship_amount: u64, // Amount to sponsor per user (lamports)
    pub total_collected: u64,
    pub total_sponsored: u64,
    pub is_initialized: bool,
}

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid fee percentage")]
    InvalidFee,
    #[msg("Amount too large")]
    AmountTooLarge,
    #[msg("Insufficient balance")]
    InsufficientBalance,
}

