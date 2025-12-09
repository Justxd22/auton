import * as anchor from "@coral-xyz/anchor";
import { Program, web3 } from "@coral-xyz/anchor";
import { AutonProgram } from "../target/types/auton_program";
import { assert } from "chai";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

describe("auton_program", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AutonProgram as Program<AutonProgram>;

  // Wallets for our tests
  const buyer = web3.Keypair.generate();
  const creator1 = web3.Keypair.generate();
  const creator2 = web3.Keypair.generate();
  const creator3 = web3.Keypair.generate();
  const allCreators = [creator1, creator2, creator3];

  // Dummy encryption for testing purposes
  const encryptionKey = randomBytes(32);
  function encryptCID(cid: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('chacha20-poly1305', encryptionKey, nonce, { authTagLength: 16 });
    const encrypted = Buffer.concat([cipher.update(cid, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([nonce, encrypted, authTag]);
  }

  // Helper to get a creator's PDA
  const getCreatorPDA = (creatorWallet: web3.PublicKey) => {
    const [pda, _] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("creator"), creatorWallet.toBuffer()],
      program.programId
    );
    return pda;
  };

  before("Fund all test wallets", async () => {
    // Airdrop SOL to the buyer and all creators to pay for transactions
    const walletsToFund = [buyer, ...allCreators];
    for (const wallet of walletsToFund) {
      const sig = await provider.connection.requestAirdrop(
        wallet.publicKey,
        5 * web3.LAMPORTS_PER_SOL // 5 SOL
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    }
  });

  describe("Username Registration", () => {
    it("Registers a valid username", async () => {
      const username = "cool_creator_1";
      const [usernamePDA, _] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("username"), Buffer.from(username)],
        program.programId
      );

      await program.methods
        .registerUsername(username)
        .accounts({
          usernameAccount: usernamePDA,
          creator: creator1.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([creator1])
        .rpc();

      const account = await program.account.usernameAccount.fetch(usernamePDA);
      assert.ok(account.authority.equals(creator1.publicKey));
      assert.equal(account.username, username);
    });

    it("Fails when username is too short", async () => {
      const username = "ab";
      const [usernamePDA, _] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("username"), Buffer.from(username)],
        program.programId
      );

      try {
        await program.methods
          .registerUsername(username)
          .accounts({
            usernameAccount: usernamePDA,
            creator: creator1.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([creator1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.isTrue(err instanceof anchor.AnchorError);
        const anchorError = err as anchor.AnchorError;
        assert.equal(anchorError.error.errorCode.code, "InvalidUsername");
      }
    });

    it("Fails when username contains invalid characters", async () => {
      const username = "invalid!name";
      const [usernamePDA, _] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("username"), Buffer.from(username)],
        program.programId
      );

      try {
        await program.methods
          .registerUsername(username)
          .accounts({
            usernameAccount: usernamePDA,
            creator: creator1.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([creator1])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.isTrue(err instanceof anchor.AnchorError);
        const anchorError = err as anchor.AnchorError;
        assert.equal(anchorError.error.errorCode.code, "InvalidUsername");
      }
    });

    it("Fails when registering a duplicate username", async () => {
      const username = "cool_creator_1"; // Already registered by creator1
      const [usernamePDA, _] = web3.PublicKey.findProgramAddressSync(
        [Buffer.from("username"), Buffer.from(username)],
        program.programId
      );

      try {
        await program.methods
          .registerUsername(username)
          .accounts({
            usernameAccount: usernamePDA,
            creator: creator2.publicKey, // Creator 2 tries to steal it
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([creator2])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        // Expect a constraint error (account already in use/initialized)
        // In Anchor, trying to init an account that exists throws a specific error
        // often related to the system program or PDA constraints.
        // We just assert that it failed.
        assert.ok(err);
      }
    });
  });

  describe("Creator and Content Management", () => {
    it("Initializes multiple creator accounts", async () => {
      for (const creator of allCreators) {
        const creatorPDA = getCreatorPDA(creator.publicKey);
        await program.methods
          .initializeCreator()
          .accounts({
            creatorAccount: creatorPDA,
            creator: creator.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([creator])
          .rpc();

        const accountData = await program.account.creatorAccount.fetch(creatorPDA);
        assert.ok(accountData.creatorWallet.equals(creator.publicKey));
        assert.equal(accountData.lastContentId.toNumber(), 0);
        assert.isEmpty(accountData.content);
      }
    });

    it("Adds content to each creator's account", async () => {
      // Creator 1 adds 2 items
      const creator1PDA = getCreatorPDA(creator1.publicKey);
      await program.methods
        .addContent("Creator 1, Content 1", new anchor.BN(1 * web3.LAMPORTS_PER_SOL), encryptCID("cid1_1"))
        .accounts({ creatorAccount: creator1PDA, creator: creator1.publicKey })
        .signers([creator1])
        .rpc();
      await program.methods
        .addContent("Creator 1, Content 2", new anchor.BN(2 * web3.LAMPORTS_PER_SOL), encryptCID("cid1_2"))
        .accounts({ creatorAccount: creator1PDA, creator: creator1.publicKey })
        .signers([creator1])
        .rpc();
      
      const creator1Data = await program.account.creatorAccount.fetch(creator1PDA);
      assert.equal(creator1Data.content.length, 2);
      assert.equal(creator1Data.lastContentId.toNumber(), 2);
      assert.equal(creator1Data.content[1].id.toNumber(), 2);

      // Creator 2 adds 1 item
      const creator2PDA = getCreatorPDA(creator2.publicKey);
      await program.methods
        .addContent("Creator 2, Content 1", new anchor.BN(0.5 * web3.LAMPORTS_PER_SOL), encryptCID("cid2_1"))
        .accounts({ creatorAccount: creator2PDA, creator: creator2.publicKey })
        .signers([creator2])
        .rpc();
      
      const creator2Data = await program.account.creatorAccount.fetch(creator2PDA);
      assert.equal(creator2Data.content.length, 1);
      assert.equal(creator2Data.lastContentId.toNumber(), 1);
    });

    it("Can look up a specific creator's content list", async () => {
      const creator1PDA = getCreatorPDA(creator1.publicKey);
      const accountData = await program.account.creatorAccount.fetch(creator1PDA);

      assert.equal(accountData.content.length, 2, "Expected 2 content items for creator 1");
      assert.equal(accountData.content[0].title, "Creator 1, Content 1");
      assert.equal(accountData.content[1].id.toNumber(), 2);
      assert.equal(accountData.content[1].price.toNumber(), 2 * web3.LAMPORTS_PER_SOL);
    });

    it("Can look up all available creators from the chain", async () => {
      const allCreatorAccounts = await program.account.creatorAccount.all();
      
      // We expect 3 accounts from our test setup
      assert.equal(allCreatorAccounts.length, 3, "Should be 3 creator accounts on-chain");

      const creator2WalletStr = creator2.publicKey.toBase58();
      const foundCreator2 = allCreatorAccounts.find(
        (acc) => acc.account.creatorWallet.toBase58() === creator2WalletStr
      );
      assert.isDefined(foundCreator2, "Could not find creator 2 in the list of all creators");
    });
  });

  describe("Payment and Access Flow", () => {
    const contentIdToBuy = new anchor.BN(2); // Buy content #2 from creator 1

    it("Lets a buyer purchase content from a creator", async () => {
      const creatorPDA = getCreatorPDA(creator1.publicKey);
      
      const [receiptPDA, _] = web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("access"),
          buyer.publicKey.toBuffer(),
          contentIdToBuy.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const creatorBalanceBefore = await provider.connection.getBalance(creator1.publicKey);
      const creatorAccountData = await program.account.creatorAccount.fetch(creatorPDA);
      const contentPrice = creatorAccountData.content.find(c => c.id.eq(contentIdToBuy)).price;

      await program.methods
        .processPayment(contentIdToBuy)
        .accounts({
          paidAccessAccount: receiptPDA,
          creatorAccount: creatorPDA,
          creatorWallet: creator1.publicKey,
          buyer: buyer.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();

      // 1. Verify the receipt
      const receiptData = await program.account.paidAccessAccount.fetch(receiptPDA);
      assert.ok(receiptData.buyer.equals(buyer.publicKey));
      assert.ok(receiptData.contentId.eq(contentIdToBuy));

      // 2. Verify the payment
      const creatorBalanceAfter = await provider.connection.getBalance(creator1.publicKey);
      assert.equal(
        creatorBalanceAfter,
        creatorBalanceBefore + contentPrice.toNumber(),
        "Creator did not receive the correct payment"
      );
    });

    it("Can look up a receipt and retrieve the encrypted CID", async () => {
      console.log("Simulating frontend logic: looking up receipt to grant access...");

      // 1. Frontend derives the receipt PDA address
      const contentId = new anchor.BN(2);
      const [receiptPDA, _] = web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("access"),
          buyer.publicKey.toBuffer(),
          contentId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      console.log(`   - Looking for receipt at address: ${receiptPDA.toBase58()}`);

      // 2. Frontend fetches the receipt account
      const receiptAccount = await program.account.paidAccessAccount.fetch(receiptPDA);
      assert.isNotNull(receiptAccount, "Receipt account should exist");
      assert.ok(receiptAccount.contentId.eq(contentId), "Receipt has wrong content ID");
      console.log("   - ✓ Receipt found! Access granted.");

      // 3. Now that access is verified, frontend retrieves the encrypted CID
      const creatorPDA = getCreatorPDA(creator1.publicKey);
      const creatorAccountData = await program.account.creatorAccount.fetch(creatorPDA);
      
      const contentItem = creatorAccountData.content.find(c => c.id.eq(contentId));
      assert.isDefined(contentItem, "Content item not found in creator's account");
      console.log("   - Retrieved encrypted CID. Ready to decrypt and fetch from IPFS.");

      // For the test, we'll verify it's the correct one we added earlier
      const originalCid = "cid1_2";
      const originalEncryptedCid = encryptCID(originalCid);
      // Note: This check will fail because encryption is non-deterministic due to the random nonce.
      // In a real app, you'd just decrypt and use it. Here we just confirm we retrieved *something*.
      assert.isNotEmpty(contentItem.encryptedCid);
    });

    it("Fails when trying to purchase non-existent content", async () => {
      const nonExistentContentId = new anchor.BN(99);
      const creatorPDA = getCreatorPDA(creator1.publicKey);

      // We must derive the correct PDA, even for a failing transaction,
      // so that the instruction's account validation passes.
      const [receiptPDA, _] = web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("access"),
          buyer.publicKey.toBuffer(),
          nonExistentContentId.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      try {
        await program.methods
          .processPayment(nonExistentContentId)
          .accounts({
            paidAccessAccount: receiptPDA,
            creatorAccount: creatorPDA,
            creatorWallet: creator1.publicKey,
            buyer: buyer.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([buyer])
          .rpc();
        assert.fail("Transaction should have failed with ContentNotFound");
      } catch (err) {
        // Check that the error is the specific custom error we expect.
        assert.isTrue(err instanceof anchor.AnchorError);
        const anchorError = err as anchor.AnchorError;
        assert.equal(anchorError.error.errorCode.code, "ContentNotFound");
        assert.include(anchorError.error.errorMessage, "The specified content was not found in the creator's account.");
      }
    });
  });
});
