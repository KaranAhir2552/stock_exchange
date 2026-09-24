use {
    anchor_lang::{
        prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn hello_runs_in_litesvm() {
    let program_id: Pubkey = afterbell::id();
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    svm.add_program(
        program_id,
        include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/afterbell.so"
        )),
    )
    .unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let ix = Instruction::new_with_bytes(
        program_id,
        &afterbell::instruction::Hello {}.data(),
        afterbell::accounts::Hello {}.to_account_metas(None),
    );
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let meta = svm.send_transaction(tx).expect("hello tx failed");
    assert!(meta.logs.iter().any(|l| l.contains("Hello from Afterbell")));
}
