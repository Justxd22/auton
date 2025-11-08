use anchor_lang::prelude::*;

declare_id!("9Dpgf1nWom5Psp6vwLs1J6WF7dVbySQwk8HhLSqXx62n");

#[program]
pub mod auton_program {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
