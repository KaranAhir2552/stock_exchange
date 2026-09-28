//! LiteSVM harness: loads the real SBPF build (`anchor build -- --features devnet-mock`).
#![allow(dead_code, clippy::result_large_err)] // TxResult is LiteSVM's own error type

use afterbell::{errors::ErrorCode, state::*, CreatePoolArgs};
use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{
        bpf_loader_upgradeable, instruction::Instruction, program_option::COption, system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::{
    token::ID as TOKEN_ID,
    token_2022::{
        spl_token_2022::{
            self,
            extension::{
                scaled_ui_amount::{PodF64, ScaledUiAmountConfig},
                transfer_fee::TransferFeeConfig,
                BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
            },
            state::Mint as SplMint,
        },
        ID as TOKEN_2022_ID,
    },
};
use litesvm::{
    types::{FailedTransactionMetadata, TransactionMetadata},
    LiteSVM,
};
use litesvm_token::{CreateAssociatedTokenAccount, CreateMint};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub const FEED: [u8; 32] = [7; 32];
/// $100.00000000 with expo -8.
pub const PRICE_100: i64 = 10_000_000_000;
pub const EXPO: i32 = -8;
pub const BASE_DECIMALS: u8 = 8;
pub const QUOTE_DECIMALS: u8 = 6;
/// $100 per share, base 8 decimals, quote 6 decimals -> 1 quote atom per base atom.
pub const P100: u128 = PRICE_SCALE;
pub const START_TS: i64 = 1_760_000_000;
pub const US_EQUITY: u8 = 1;

/// Unix seconds for a UTC date-time (proleptic Gregorian; days-from-civil algorithm).
pub fn utc(y: i64, m: i64, d: i64, hh: i64, mm: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) * 86_400 + hh * 3_600 + mm * 60
}

pub struct PythUpdate {
    pub feed: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub publish_ts: i64,
    pub full: bool,
    pub owner: Pubkey,
}

impl PythUpdate {
    /// A fully verified update for FEED at `price`, published at `publish_ts`, owned by the receiver.
    pub fn new(price: i64, publish_ts: i64) -> Self {
        PythUpdate {
            feed: FEED,
            price,
            conf: 0,
            publish_ts,
            full: true,
            owner: pyth_solana_receiver_sdk::ID,
        }
    }
}

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub fn default_params() -> PoolParams {
    PoolParams {
        open_band_bps: 100,
        closed_base_band_bps: 200,
        closed_band_growth_bps_per_hour: 10,
        closed_max_band_bps: 1_000,
        open_fee_bps: 30,
        closed_base_fee_bps: 60,
        closed_fee_growth_bps_per_hour: 1,
        closed_max_fee_bps: 300,
        size_fee_bps_per_1pct_depth: 5,
        depth_bps: 10_000,
        max_tvl_quote: 0,
    }
}

pub fn pool_args(params: PoolParams) -> CreatePoolArgs {
    CreatePoolArgs {
        profile: MarketProfile::AlwaysOpen,
        oracle_kind: OracleKind::Mock,
        feed_id: FEED,
        max_staleness_secs: 60,
        max_conf_bps: 100,
        params,
    }
}

pub fn assert_err(res: TxResult, code: ErrorCode) {
    let err = res.expect_err("expected the transaction to fail");
    let want = anchor_lang::error::ERROR_CODE_OFFSET + code as u32;
    let got = format!("{:?}", err.err);
    assert!(
        got.contains(&format!("Custom({want})")),
        "expected {code:?} (Custom({want})), got {got}\nlogs: {:#?}",
        err.meta.logs
    );
}

pub struct H {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub user: Keypair,
    pub treasury: Keypair,
    pub guardian: Keypair,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_prog: Pubkey,
    pub quote_prog: Pubkey,
    /// Set once a calendar exists; passed to every pool instruction that refreshes the mode.
    pub calendar: Option<Pubkey>,
    /// Pyth price account to pass instead of the mock oracle.
    pub pyth: Option<Pubkey>,
}

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &afterbell::ID).0
}

impl H {
    /// Program loaded, admin set as upgrade authority, clock at START_TS. No config yet.
    pub fn bare() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            afterbell::ID,
            include_bytes!(concat!(
                env!("CARGO_TARGET_TMPDIR"),
                "/../deploy/afterbell.so"
            )),
        )
        .unwrap();
        let (admin, user, treasury, guardian) = (
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
            Keypair::new(),
        );
        for k in [&admin, &user, &treasury, &guardian] {
            svm.airdrop(&k.pubkey(), 100_000_000_000).unwrap();
        }
        // LiteSVM deploys with no upgrade authority; make admin the authority.
        // ProgramData layout: u32 tag, u64 slot, Option<Pubkey> (1-byte tag + 32 bytes).
        let pd =
            Pubkey::find_program_address(&[afterbell::ID.as_ref()], &bpf_loader_upgradeable::ID).0;
        let mut acc = svm.get_account(&pd).unwrap();
        acc.data[12] = 1;
        acc.data[13..45].copy_from_slice(admin.pubkey().as_ref());
        svm.set_account(pd, acc).unwrap();

        let mut h = H {
            svm,
            admin,
            user,
            treasury,
            guardian,
            base_mint: Pubkey::default(),
            quote_mint: Pubkey::default(),
            base_prog: TOKEN_ID,
            quote_prog: TOKEN_ID,
            calendar: None,
            pyth: None,
        };
        h.set_time(START_TS);
        h
    }

    /// Config + mock price + SPL mints + an Open pool.
    pub fn new() -> Self {
        let mut h = Self::bare();
        h.init_config(0).unwrap();
        h.set_price(PRICE_100, 0).unwrap();
        h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
        h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
        h.create_pool(pool_args(default_params())).unwrap();
        h
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
        self.svm.expire_blockhash();
        let payer = signers[0].pubkey();
        let msg = Message::new_with_blockhash(ixs, Some(&payer), &self.svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        self.svm.send_transaction(tx)
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, ts: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp = ts;
        self.svm.set_sysvar(&c);
    }

    pub fn warp(&mut self, secs: i64) {
        let t = self.now() + secs;
        self.set_time(t);
    }

    // ---------- accounts ----------

    pub fn pool(&self) -> Pubkey {
        pda(&[POOL_SEED, self.base_mint.as_ref(), self.quote_mint.as_ref()])
    }
    pub fn vault(&self, mint: &Pubkey) -> Pubkey {
        pda(&[VAULT_SEED, self.pool().as_ref(), mint.as_ref()])
    }
    pub fn lp_mint(&self) -> Pubkey {
        pda(&[LP_SEED, self.pool().as_ref()])
    }
    pub fn config(&self) -> Pubkey {
        pda(&[CONFIG_SEED])
    }
    pub fn oracle(&self) -> Pubkey {
        self.pyth.unwrap_or_else(|| self.oracle_for(FEED))
    }
    pub fn oracle_for(&self, feed: [u8; 32]) -> Pubkey {
        pda(&[MOCK_ORACLE_SEED, feed.as_ref()])
    }

    pub fn pool_state(&self) -> Pool {
        let acc = self.svm.get_account(&self.pool()).unwrap();
        Pool::try_deserialize(&mut &acc.data[..]).unwrap()
    }

    /// Token account amount (same offset for SPL Token and Token-2022).
    pub fn balance(&self, token_account: &Pubkey) -> u64 {
        let d = self.svm.get_account(token_account).unwrap().data;
        u64::from_le_bytes(d[64..72].try_into().unwrap())
    }
    pub fn supply(&self, mint: &Pubkey) -> u64 {
        let d = self.svm.get_account(mint).unwrap().data;
        u64::from_le_bytes(d[36..44].try_into().unwrap())
    }

    pub fn spl_mint(&mut self, decimals: u8, program: Pubkey) -> Pubkey {
        CreateMint::new(&mut self.svm, &self.admin)
            .decimals(decimals)
            .token_program_id(&program)
            .send()
            .unwrap()
    }

    /// Token-2022 mint with the given extensions written directly into account data.
    pub fn t22_mint(
        &mut self,
        decimals: u8,
        scaled_multiplier: Option<f64>,
        transfer_fee: bool,
    ) -> Pubkey {
        let mut exts = vec![];
        if scaled_multiplier.is_some() {
            exts.push(ExtensionType::ScaledUiAmount);
        }
        if transfer_fee {
            exts.push(ExtensionType::TransferFeeConfig);
        }
        let len = ExtensionType::try_calculate_account_len::<SplMint>(&exts).unwrap();
        let mut data = vec![0u8; len];
        let mut state = StateWithExtensionsMut::<SplMint>::unpack_uninitialized(&mut data).unwrap();
        if let Some(m) = scaled_multiplier {
            let e = state.init_extension::<ScaledUiAmountConfig>(true).unwrap();
            e.multiplier = PodF64::from(m);
            e.new_multiplier = PodF64::from(m);
            e.new_multiplier_effective_timestamp = i64::MAX.into();
        }
        if transfer_fee {
            state.init_extension::<TransferFeeConfig>(true).unwrap();
        }
        state.base = SplMint {
            mint_authority: COption::Some(self.admin.pubkey()),
            supply: 0,
            decimals,
            is_initialized: true,
            freeze_authority: COption::None,
        };
        state.pack_base();
        state.init_account_type().unwrap();
        let mint = Keypair::new().pubkey();
        let lamports = self.svm.minimum_balance_for_rent_exemption(len);
        self.svm
            .set_account(
                mint,
                solana_account::Account {
                    lamports,
                    data,
                    owner: TOKEN_2022_ID,
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        mint
    }

    /// Writes a Pyth `PriceUpdateV2` account (as the receiver program would) and returns its address.
    pub fn post_pyth(&mut self, u: PythUpdate) -> Pubkey {
        use anchor_lang::{AnchorSerialize, Discriminator};
        use pyth_solana_receiver_sdk::price_update::{
            PriceFeedMessage, PriceUpdateV2, VerificationLevel,
        };
        let update = PriceUpdateV2 {
            write_authority: self.admin.pubkey(),
            verification_level: if u.full {
                VerificationLevel::Full
            } else {
                VerificationLevel::Partial { num_signatures: 5 }
            },
            price_message: PriceFeedMessage {
                feed_id: u.feed,
                price: u.price,
                conf: u.conf,
                exponent: EXPO,
                publish_time: u.publish_ts,
                prev_publish_time: u.publish_ts - 1,
                ema_price: u.price,
                ema_conf: u.conf,
            },
            posted_slot: 1,
        };
        let mut data = PriceUpdateV2::DISCRIMINATOR.to_vec();
        update.serialize(&mut data).unwrap();
        let key = Keypair::new().pubkey();
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        let account = solana_account::Account {
            lamports,
            data,
            owner: u.owner,
            executable: false,
            rent_epoch: 0,
        };
        self.svm.set_account(key, account).unwrap();
        key
    }

    /// Creates `owner`'s ATA for `mint` and mints `amount` into it.
    pub fn fund(&mut self, owner: &Pubkey, mint: &Pubkey, program: &Pubkey, amount: u64) -> Pubkey {
        let ata = CreateAssociatedTokenAccount::new(&mut self.svm, &self.admin, mint)
            .owner(owner)
            .token_program_id(program)
            .send()
            .unwrap();
        if amount > 0 {
            // litesvm-token's MintTo only builds classic SPL Token instructions; this builder takes either program.
            let ix = spl_token_2022::instruction::mint_to(
                program,
                mint,
                &ata,
                &self.admin.pubkey(),
                &[],
                amount,
            )
            .unwrap();
            let admin = self.admin.insecure_clone();
            self.send(&[ix], &[&admin]).unwrap();
        }
        ata
    }

    /// Funds the user with base, quote, and an empty LP account; returns (base, quote, lp) ATAs.
    pub fn fund_user(&mut self, base: u64, quote: u64) -> (Pubkey, Pubkey, Pubkey) {
        let u = self.user.pubkey();
        let (bm, qm, bp, qp, lp) = (
            self.base_mint,
            self.quote_mint,
            self.base_prog,
            self.quote_prog,
            self.lp_mint(),
        );
        (
            self.fund(&u, &bm, &bp, base),
            self.fund(&u, &qm, &qp, quote),
            self.fund(&u, &lp, &TOKEN_ID, 0),
        )
    }

    // ---------- instructions ----------

    pub fn admin_ix(&mut self, ix: Instruction) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &[&admin])
    }

    pub fn create_calendar(&mut self) -> TxResult {
        let calendar = pda(&[CALENDAR_SEED, &[US_EQUITY]]);
        self.calendar = Some(calendar);
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::CreateCalendar {
                profile_id: US_EQUITY,
            }
            .data(),
            afterbell::accounts::CreateCalendar {
                admin: self.admin.pubkey(),
                config: self.config(),
                calendar,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.admin_ix(ix)
    }

    pub fn set_sessions(&mut self, sessions: Vec<Session>, valid_until: i64) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::SetSessions {
                sessions,
                valid_until,
            }
            .data(),
            afterbell::accounts::SetSessions {
                admin: self.admin.pubkey(),
                config: self.config(),
                calendar: pda(&[CALENDAR_SEED, &[US_EQUITY]]),
            }
            .to_account_metas(None),
        );
        self.admin_ix(ix)
    }

    pub fn set_params(&mut self, params: PoolParams) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.set_params_as(&admin, params)
    }

    pub fn set_params_as(&mut self, signer: &Keypair, params: PoolParams) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::SetParams { params }.data(),
            afterbell::accounts::SetParams {
                admin: signer.pubkey(),
                config: self.config(),
                pool: self.pool(),
            }
            .to_account_metas(None),
        );
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer])
    }

    pub fn set_halt_as(&mut self, signer: &Keypair, halted: bool) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::SetHalt { halted }.data(),
            afterbell::accounts::SetHalt {
                authority: signer.pubkey(),
                config: self.config(),
                pool: self.pool(),
            }
            .to_account_metas(None),
        );
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer])
    }

    pub fn set_global_pause_as(&mut self, signer: &Keypair, paused: bool) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::SetGlobalPause { paused }.data(),
            afterbell::accounts::SetGlobalPause {
                authority: signer.pubkey(),
                config: self.config(),
            }
            .to_account_metas(None),
        );
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer])
    }

    pub fn init_config_as(&mut self, payer: &Keypair, protocol_fee_bps: u16) -> TxResult {
        let pd =
            Pubkey::find_program_address(&[afterbell::ID.as_ref()], &bpf_loader_upgradeable::ID).0;
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::InitializeConfig {
                admin: self.admin.pubkey(),
                guardian: self.guardian.pubkey(),
                treasury: self.treasury.pubkey(),
                protocol_fee_bps,
            }
            .data(),
            afterbell::accounts::InitializeConfig {
                payer: payer.pubkey(),
                config: self.config(),
                program: afterbell::ID,
                program_data: pd,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let payer = payer.insecure_clone();
        self.send(&[ix], &[&payer])
    }

    pub fn init_config(&mut self, protocol_fee_bps: u16) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.init_config_as(&admin, protocol_fee_bps)
    }

    pub fn set_price(&mut self, price: i64, conf: u64) -> TxResult {
        self.set_price_for(FEED, price, conf)
    }

    pub fn set_price_for(&mut self, feed: [u8; 32], price: i64, conf: u64) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::MockSetPrice {
                feed_id: feed,
                price,
                conf,
                expo: EXPO,
            }
            .data(),
            afterbell::accounts::MockSetPrice {
                admin: self.admin.pubkey(),
                config: self.config(),
                mock_oracle: self.oracle_for(feed),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &[&admin])
    }

    pub fn set_status(&mut self, status: MockStatus) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::MockSetStatus { status }.data(),
            afterbell::accounts::MockSetStatus {
                admin: self.admin.pubkey(),
                config: self.config(),
                mock_oracle: self.oracle(),
            }
            .to_account_metas(None),
        );
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &[&admin])
    }

    /// Moves the mock feed's simulated clock forward (demo week); `signer` must be the admin.
    pub fn advance_clock_as(&mut self, signer: &Keypair, seconds: i64) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::MockAdvanceClock { seconds }.data(),
            afterbell::accounts::MockSetStatus {
                admin: signer.pubkey(),
                config: self.config(),
                mock_oracle: self.oracle(),
            }
            .to_account_metas(None),
        );
        self.send(&[ix], &[signer])
    }

    pub fn advance_clock(&mut self, seconds: i64) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.advance_clock_as(&admin, seconds)
    }

    pub fn heartbeat(&mut self) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::MockHeartbeat {}.data(),
            afterbell::accounts::MockSetStatus {
                admin: self.admin.pubkey(),
                config: self.config(),
                mock_oracle: self.oracle(),
            }
            .to_account_metas(None),
        );
        let admin = self.admin.insecure_clone();
        self.send(&[ix], &[&admin])
    }

    pub fn mock_state(&self) -> MockOracle {
        let acc = self.svm.get_account(&self.oracle()).unwrap();
        MockOracle::try_deserialize(&mut &acc.data[..]).unwrap()
    }

    /// The pool's clock: real time plus the mock feed's simulated offset.
    pub fn sim_now(&self) -> i64 {
        let acc = self.svm.get_account(&self.oracle()).unwrap();
        self.now()
            + MockOracle::try_deserialize(&mut &acc.data[..])
                .unwrap()
                .clock_offset
    }

    pub fn create_pool_as(
        &mut self,
        signer: &Keypair,
        args: CreatePoolArgs,
        oracle: Pubkey,
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::CreatePool { args }.data(),
            afterbell::accounts::CreatePool {
                admin: signer.pubkey(),
                config: self.config(),
                pool: self.pool(),
                base_mint: self.base_mint,
                quote_mint: self.quote_mint,
                base_vault: self.vault(&self.base_mint),
                quote_vault: self.vault(&self.quote_mint),
                lp_mint: self.lp_mint(),
                oracle,
                calendar: self.calendar,
                base_token_program: self.base_prog,
                quote_token_program: self.quote_prog,
                lp_token_program: TOKEN_ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let signer = signer.insecure_clone();
        self.send(&[ix], &[&signer])
    }

    pub fn create_pool(&mut self, args: CreatePoolArgs) -> TxResult {
        let (admin, oracle) = (self.admin.insecure_clone(), self.oracle());
        self.create_pool_as(&admin, args, oracle)
    }

    pub fn update_reference_with(&mut self, oracle: Pubkey) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::UpdateReference {}.data(),
            afterbell::accounts::UpdateReference {
                config: self.config(),
                pool: self.pool(),
                base_mint: self.base_mint,
                oracle,
                calendar: self.calendar,
            }
            .to_account_metas(None),
        );
        // Anyone can call it: the treasury key stands in for a random keeper.
        let keeper = self.treasury.insecure_clone();
        self.send(&[ix], &[&keeper])
    }

    pub fn update_reference(&mut self) -> TxResult {
        let o = self.oracle();
        self.update_reference_with(o)
    }

    pub fn deposit(
        &mut self,
        atas: (Pubkey, Pubkey, Pubkey),
        max_base: u64,
        max_quote: u64,
        min_lp: u64,
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::Deposit {
                max_base,
                max_quote,
                min_lp_out: min_lp,
            }
            .data(),
            afterbell::accounts::Deposit {
                user: self.user.pubkey(),
                config: self.config(),
                pool: self.pool(),
                base_mint: self.base_mint,
                quote_mint: self.quote_mint,
                base_vault: self.vault(&self.base_mint),
                quote_vault: self.vault(&self.quote_mint),
                lp_mint: self.lp_mint(),
                user_base: atas.0,
                user_quote: atas.1,
                user_lp: atas.2,
                oracle: self.oracle(),
                calendar: self.calendar,
                base_token_program: self.base_prog,
                quote_token_program: self.quote_prog,
                lp_token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        let user = self.user.insecure_clone();
        self.send(&[ix], &[&user])
    }

    pub fn withdraw(
        &mut self,
        atas: (Pubkey, Pubkey, Pubkey),
        lp: u64,
        min_base: u64,
        min_quote: u64,
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::Withdraw {
                lp_amount: lp,
                min_base_out: min_base,
                min_quote_out: min_quote,
            }
            .data(),
            afterbell::accounts::Withdraw {
                user: self.user.pubkey(),
                pool: self.pool(),
                base_mint: self.base_mint,
                quote_mint: self.quote_mint,
                base_vault: self.vault(&self.base_mint),
                quote_vault: self.vault(&self.quote_mint),
                lp_mint: self.lp_mint(),
                user_base: atas.0,
                user_quote: atas.1,
                user_lp: atas.2,
                base_token_program: self.base_prog,
                quote_token_program: self.quote_prog,
                lp_token_program: TOKEN_ID,
            }
            .to_account_metas(None),
        );
        let user = self.user.insecure_clone();
        self.send(&[ix], &[&user])
    }

    pub fn swap_with(
        &mut self,
        atas: (Pubkey, Pubkey, Pubkey),
        amount_in: u64,
        min_out: u64,
        direction: Direction,
        oracle: Pubkey,
        treasury_token: Option<Pubkey>,
    ) -> TxResult {
        let ix = Instruction::new_with_bytes(
            afterbell::ID,
            &afterbell::instruction::Swap {
                amount_in,
                min_amount_out: min_out,
                direction,
            }
            .data(),
            afterbell::accounts::Swap {
                user: self.user.pubkey(),
                config: self.config(),
                pool: self.pool(),
                base_mint: self.base_mint,
                quote_mint: self.quote_mint,
                base_vault: self.vault(&self.base_mint),
                quote_vault: self.vault(&self.quote_mint),
                user_base: atas.0,
                user_quote: atas.1,
                oracle,
                calendar: self.calendar,
                treasury_token,
                base_token_program: self.base_prog,
                quote_token_program: self.quote_prog,
            }
            .to_account_metas(None),
        );
        let user = self.user.insecure_clone();
        self.send(&[ix], &[&user])
    }

    pub fn swap(
        &mut self,
        atas: (Pubkey, Pubkey, Pubkey),
        amount_in: u64,
        min_out: u64,
        direction: Direction,
    ) -> TxResult {
        let o = self.oracle();
        self.swap_with(atas, amount_in, min_out, direction, o, None)
    }

    /// Pool with 1M base atoms / 1M quote atoms of user liquidity at price 1 (P100).
    pub fn seeded(amount: u64) -> (Self, (Pubkey, Pubkey, Pubkey)) {
        let mut h = Self::new();
        let atas = h.fund_user(10 * amount, 10 * amount);
        h.deposit(atas, amount, amount, 0).unwrap();
        (h, atas)
    }
}

// ---------- shared scenario fixtures ----------

pub type Atas = (
    anchor_lang::prelude::Pubkey,
    anchor_lang::prelude::Pubkey,
    anchor_lang::prelude::Pubkey,
);

pub fn s(open: i64, close: i64) -> Session {
    Session {
        open_ts: open,
        close_ts: close,
    }
}

/// Thu Oct 1, Fri Oct 2, Mon Oct 5, Tue Oct 6 2026, 9:30-16:00 EDT.
pub fn october() -> Vec<Session> {
    [(10, 1), (10, 2), (10, 5), (10, 6)]
        .iter()
        .map(|&(m, d)| s(utc(2026, m, d, 13, 30), utc(2026, m, d, 20, 0)))
        .collect()
}

/// Thanksgiving week 2026 (EST): Wed normal, Thu closed, Fri early close 13:00 ET, Mon normal.
pub fn thanksgiving() -> Vec<Session> {
    vec![
        s(utc(2026, 11, 25, 14, 30), utc(2026, 11, 25, 21, 0)),
        s(utc(2026, 11, 27, 14, 30), utc(2026, 11, 27, 18, 0)),
        s(utc(2026, 11, 30, 14, 30), utc(2026, 11, 30, 21, 0)),
    ]
}

/// UsEquity pool created at `now` (price published at `now`), seeded with 1M/1M when it opens.
pub fn equity(now: i64, sessions: Vec<Session>, valid_until: i64) -> (H, Atas) {
    let mut h = H::bare();
    h.set_time(now);
    h.init_config(0).unwrap();
    h.create_calendar().unwrap();
    h.set_sessions(sessions, valid_until).unwrap();
    h.set_price(PRICE_100, 0).unwrap();
    h.base_mint = h.spl_mint(BASE_DECIMALS, TOKEN_ID);
    h.quote_mint = h.spl_mint(QUOTE_DECIMALS, TOKEN_ID);
    let mut args = pool_args(default_params());
    args.profile = MarketProfile::UsEquity;
    h.create_pool(args).unwrap();
    let atas = h.fund_user(10_000_000, 10_000_000);
    if h.pool_state().mode == Mode::Open {
        h.deposit(atas, 1_000_000, 1_000_000, 0).unwrap();
    }
    (h, atas)
}
