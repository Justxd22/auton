use anchor_lang::prelude::*;


// This is the program's on-chain ID.
// It will be replaced with the real Program ID after deployment.
declare_id!("9Dpgf1nWom5Psp6vwLs1J6WF7dVbySQwk8HhLSqXx62n");

#[program]
pub mod auton_program {
    use super::*;

    // NEW: Registers a username for a creator
    // This creates a PDA that maps a username to a wallet address
    pub fn register_username(ctx: Context<RegisterUsername>, username: String) -> Result<()> {
        // Validate username
        require!(username.len() >= 3 && username.len() <= 32, CustomError::InvalidUsername);
        require!(
            username.chars().all(|c| c.is_alphanumeric() || c == '_'),
            CustomError::InvalidUsername
        );

        let username_account = &mut ctx.accounts.username_account;
        username_account.authority = *ctx.accounts.creator.key;
        username_account.username = username;

        Ok(())
    }

    // Initializes a new account for a creator to hold their content list.
    // This only needs to be called once per creator.
    pub fn initialize_creator(ctx: Context<InitializeCreator>) -> Result<()> {
        let creator_account = &mut ctx.accounts.creator_account;
        creator_account.creator_wallet = *ctx.accounts.creator.key;
        creator_account.content = Vec::new();
        creator_account.last_content_id = 0;
        Ok(())
    }

    // Adds a new piece of content to the creator's account.
    pub fn add_content(
        ctx: Context<AddContent>,
        title: String,
        price: u64,
        encrypted_cid: Vec<u8>,
    ) -> Result<()> {
        let creator_account = &mut ctx.accounts.creator_account;
        
        require!(creator_account.creator_wallet == *ctx.accounts.creator.key, CustomError::Unauthorized);

        // Increment the counter to get a new ID
        creator_account.last_content_id += 1;
        let new_id = creator_account.last_content_id;

        let new_content = ContentItem {
            id: new_id,
            title,
            price,
            encrypted_cid,
        };

        creator_account.content.push(new_content);
        Ok(())
    }

    // Records that a user has paid for a specific piece of content.
    // This transfers SOL from buyer to creator and creates an access receipt.
    pub fn process_payment(ctx: Context<ProcessPayment>, content_id: u64) -> Result<()> {
        let creator_account = &ctx.accounts.creator_account;

        // Find the content item by its ID. This is much more efficient than hashing.
        let content_item = creator_account.content.iter().find(|item| {
            item.id == content_id
        }).ok_or(CustomError::ContentNotFound)?;

        let amount_to_pay = content_item.price;

        // Transfer SOL from buyer to creator's wallet
        let transfer_instruction = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.creator_wallet.key(), // Use the verified wallet from the creator_account
            amount_to_pay,
        );
        
        anchor_lang::solana_program::program::invoke(
            &transfer_instruction,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.creator_wallet.to_account_info(), // Use the verified wallet
            ],
        )?;

        // Create the access receipt
        let access_account = &mut ctx.accounts.paid_access_account;
        access_account.buyer = *ctx.accounts.buyer.key;
        access_account.content_id = content_id;
        Ok(())
    }
}

// 1. ACCOUNTS (State)
// These structs define the shape of the data we store on-chain.

// NEW: Username registry entry - maps username to wallet address
#[account]
pub struct UsernameAccount {
    pub authority: Pubkey,  // The creator's wallet address
    pub username: String,   // The username itself
}

#[account]
pub struct CreatorAccount {
    pub creator_wallet: Pubkey,
    pub last_content_id: u64, // Counter for generating unique content IDs
    pub content: Vec<ContentItem>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentItem {
    pub id: u64, // Unique ID for the content
    pub title: String,
    pub price: u64, // Price in lamports
    pub encrypted_cid: Vec<u8>, // Encrypted IPFS CID (ciphertext + nonce + auth tag)
}

#[account]
pub struct PaidAccessAccount {
    pub buyer: Pubkey,
    pub content_id: u64, // ID of the content this receipt grants access to
}


// 2. INSTRUCTION CONTEXTS
// These structs define the accounts required by each instruction.
// Anchor uses this to validate that the correct accounts are passed in.

// NEW: Context for registering a username
#[derive(Accounts)]
#[instruction(username: String)]
pub struct RegisterUsername<'info> {
    // The PDA account for the username registry entry.
    // Seeds include the username, ensuring each username can only be claimed once.
    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 4 + username.len(), // discriminator + pubkey + string length + username
        seeds = [b"username", username.as_bytes()],
        bump
    )]
    pub username_account: Account<'info, UsernameAccount>,

    // The creator claiming the username
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeCreator<'info> {
    // The PDA account for the creator's content list.
    // `init` means this instruction will create the account.
    // `payer = creator` means the creator will pay for the account's rent.
    // `space` is the initial space allocation. 8 for the discriminator, 32 for the pubkey, 4 for the vector prefix.
    // We will need to reallocate more space later when content is added.
    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 8 + 4, // discriminator + wallet + counter + vec prefix
        seeds = [b"creator", creator.key().as_ref()],
        bump
    )]
    pub creator_account: Account<'info, CreatorAccount>,
    
    // The creator, who must sign the transaction.
    #[account(mut)]
    pub creator: Signer<'info>,
    
    // The system program, required by Solana to create accounts.
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddContent<'info> {
    // The creator's content list account. It must be mutable to add content.
    // `realloc` will increase the account's size to fit the new content.
    // `realloc::payer` specifies who pays for the extra rent.
    // `realloc::zero` ensures the new memory is zeroed out.
    #[account(
        mut,
        seeds = [b"creator", creator.key().as_ref()],
        bump,
        // Approximate: id(8) + title(128) + price(8) + encrypted_cid(100)
        realloc = 8 + 32 + 8 + 4 + (creator_account.content.len() + 1) * (8 + 4 + 128 + 8 + 4 + 100), 
        realloc::payer = creator,
        realloc::zero = true
    )]
    pub creator_account: Account<'info, CreatorAccount>,

    // The creator, who must sign.
    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct ProcessPayment<'info> {
    // The PDA "receipt" account.
    // The seeds ensure that a user can only have one receipt per content item.
    #[account(
        init,
        payer = buyer,
        space = 8 + 32 + 8, // discriminator + buyer pubkey + content_id
        seeds = [b"access", buyer.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub paid_access_account: Account<'info, PaidAccessAccount>,

    // The creator's account, used to verify the payment destination and price.
    #[account(mut)]
    pub creator_account: Account<'info, CreatorAccount>,

    // The creator's wallet, derived from the creator_account.
    // The `address` constraint is a key security feature: it ensures the client
    // passes the correct wallet address that is stored in the creator_account.
    /// CHECK: This is the creator's wallet address, validated by the address constraint.
    #[account(mut, address = creator_account.creator_wallet)]
    pub creator_wallet: AccountInfo<'info>,

    // The user who is paying.
    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}


// 3. ERRORS
// Custom errors for our program.

#[error_code]
pub enum CustomError {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
    #[msg("The specified content was not found in the creator's account.")]
    ContentNotFound,

    #[msg("Invalid username. Must be 3-32 characters, alphanumeric or underscore only.")]
    InvalidUsername,
}