//! Writes packages/sdk/test/vectors.json: swaps executed by the real SBPF program, with every input
//! the SDK needs to predict them. The SDK test replays these; CI fails if the committed file differs
//! from what this test produces, so the TypeScript mirror can't drift from the program.
mod common;

use afterbell::state::*;
use anchor_lang::AccountDeserialize;
use common::*;

/// xorshift64*: deterministic, so the output file is stable across runs.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn range(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.next() % (hi - lo)
    }
}

fn params_json(p: &PoolParams) -> String {
    format!(
        r#"{{"openBandBps":{},"closedBaseBandBps":{},"closedBandGrowthBpsPerHour":{},"closedMaxBandBps":{},"openFeeBps":{},"closedBaseFeeBps":{},"closedFeeGrowthBpsPerHour":{},"closedMaxFeeBps":{},"sizeFeeBpsPer1PctDepth":{},"depthBps":{},"maxTvlQuote":"{}"}}"#,
        p.open_band_bps,
        p.closed_base_band_bps,
        p.closed_band_growth_bps_per_hour,
        p.closed_max_band_bps,
        p.open_fee_bps,
        p.closed_base_fee_bps,
        p.closed_fee_growth_bps_per_hour,
        p.closed_max_fee_bps,
        p.size_fee_bps_per_1pct_depth,
        p.depth_bps,
        p.max_tvl_quote
    )
}

fn snapshot(h: &H) -> String {
    let p = h.pool_state();
    let pool = format!(
        r#"{{"profile":"{:?}","mode":"{:?}","halted":{},"poolPrice":"{}","referencePrice":"{}","closeTs":"{}","lastOraclePublishTs":"{}","maxStalenessSecs":{},"maxConfBps":{},"baseDecimals":{},"quoteDecimals":{},"params":{}}}"#,
        p.profile,
        p.mode,
        p.halted,
        p.pool_price,
        p.reference_price,
        p.close_ts,
        p.last_oracle_publish_ts,
        p.max_staleness_secs,
        p.max_conf_bps,
        p.base_decimals,
        p.quote_decimals,
        params_json(&p.params)
    );
    let calendar = match h.calendar {
        None => "null".to_string(),
        Some(k) => {
            let c = MarketCalendar::try_deserialize(&mut &h.svm.get_account(&k).unwrap().data[..])
                .unwrap();
            let sessions: Vec<String> = c
                .active()
                .iter()
                .map(|s| format!(r#"["{}","{}"]"#, s.open_ts, s.close_ts))
                .collect();
            format!(
                r#"{{"sessions":[{}],"validUntil":"{}"}}"#,
                sessions.join(","),
                c.valid_until
            )
        }
    };
    let o = MockOracle::try_deserialize(&mut &h.svm.get_account(&h.oracle()).unwrap().data[..])
        .unwrap();
    let oracle = format!(
        r#"{{"price":"{}","conf":"{}","expo":{},"publishTs":"{}","status":"{:?}"}}"#,
        o.price, o.conf, o.expo, o.publish_ts, o.status
    );
    let (vb, vq) = (h.vault(&h.base_mint), h.vault(&h.quote_mint));
    format!(
        r#""pool":{pool},"baseReserve":"{}","quoteReserve":"{}","globalPause":false,"calendar":{calendar},"oracle":{oracle},"now":"{}""#,
        h.balance(&vb),
        h.balance(&vq),
        h.now()
    )
}

fn record(h: &mut H, atas: Atas, amount_in: u64, dir: Direction, out: &mut Vec<String>) {
    let before = snapshot(h);
    let (recv, was) = match dir {
        Direction::BaseToQuote => (atas.1, h.balance(&atas.1)),
        Direction::QuoteToBase => (atas.0, h.balance(&atas.0)),
    };
    let result = match h.swap(atas, amount_in, 0, dir) {
        Ok(_) => {
            let p = h.pool_state();
            format!(
                r#"{{"ok":{{"amountOut":"{}","newPrice":"{}","mode":"{:?}"}}}}"#,
                h.balance(&recv) - was,
                p.pool_price,
                p.mode
            )
        }
        Err(e) => {
            let s = format!("{:?}", e.err);
            let code = s
                .split("Custom(")
                .nth(1)
                .and_then(|r| r.split(')').next())
                .expect("custom error");
            format!(r#"{{"err":{code}}}"#)
        }
    };
    out.push(format!(
        r#"{{{before},"amountIn":"{amount_in}","direction":"{dir:?}","result":{result}}}"#
    ));
}

#[test]
fn write_sdk_parity_vectors() {
    let mut rng = Rng(0x5EED_AF7E_2BE1);
    let mut out = Vec::new();
    let friday = utc(2026, 10, 2, 15, 0);
    for scenario in 0..30u64 {
        let (mut h, atas) = if scenario % 5 == 4 {
            let (mut h, atas) = H::seeded(1_000_000);
            h.set_time(friday);
            h.set_price(PRICE_100, 0).unwrap();
            (h, atas)
        } else {
            equity(friday, october(), utc(2026, 10, 10, 0, 0))
        };
        // Vary reserves (uneven sides exercise two-sided depth) and parameters.
        h.deposit(atas, rng.range(1, 3_000_000), rng.range(1, 3_000_000), 0)
            .ok();
        if rng.range(0, 2) == 0 {
            let mut p = default_params();
            p.depth_bps = rng.range(500, 10_001) as u16;
            p.size_fee_bps_per_1pct_depth = rng.range(0, 50) as u16;
            p.open_band_bps = rng.range(20, 400) as u16;
            h.set_params(p).unwrap();
        }
        match scenario % 5 {
            // Open, newer oracle price: the swap itself re-centres first.
            1 => {
                h.warp(rng.range(1, 50) as i64);
                h.set_price(
                    PRICE_100 + rng.range(0, 100_000_000) as i64 - 50_000_000,
                    rng.range(0, 5_000_000),
                )
                .unwrap();
            }
            // After Friday's close; the first swap triggers Open -> Closed. Hours into the weekend vary.
            2 => h.set_time(utc(2026, 10, 2, 20, 0) + rng.range(0, 70 * 3_600) as i64),
            // Stale oracle in session -> Paused.
            3 => h.warp(rng.range(121, 1_000) as i64),
            _ => {}
        }
        for _ in 0..4 {
            let dir = if rng.range(0, 2) == 0 {
                Direction::BaseToQuote
            } else {
                Direction::QuoteToBase
            };
            let amount = rng.range(1, 30_000);
            record(&mut h, atas, amount, dir, &mut out);
            // 4 swaps x <15s stays under the 60s staleness limit (scenario 3 is stale on purpose).
            h.warp(rng.range(0, 15) as i64);
        }
    }
    let json = format!("[\n{}\n]\n", out.join(",\n"));
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/sdk/test/vectors.json"
    );
    std::fs::write(path, json).unwrap();
}
