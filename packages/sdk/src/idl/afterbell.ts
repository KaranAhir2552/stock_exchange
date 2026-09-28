/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/afterbell.json`.
 */
export type Afterbell = {
  "address": "AUkfc1YB8AB1BSno52xnsPvKcXYCbnHyySDxhrkmwp9x",
  "metadata": {
    "name": "afterbell",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Afterbell: oracle-anchored pool that stays fair when the stock market is closed"
  },
  "instructions": [
    {
      "name": "createCalendar",
      "discriminator": [
        140,
        70,
        1,
        99,
        123,
        36,
        66,
        161
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "calendar",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "profileId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createPool",
      "discriminator": [
        233,
        146,
        209,
        142,
        207,
        104,
        64,
        188
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "baseMint"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "baseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "baseMint"
              }
            ]
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ]
          }
        },
        {
          "name": "lpMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              }
            ]
          }
        },
        {
          "name": "oracle"
        },
        {
          "name": "calendar",
          "docs": [
            "Required for profiles with market hours; checked against the profile id in the handler."
          ],
          "optional": true
        },
        {
          "name": "baseTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "lpTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createPoolArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "baseMint"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ]
          }
        },
        {
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "baseVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBase",
          "writable": true
        },
        {
          "name": "userQuote",
          "writable": true
        },
        {
          "name": "userLp",
          "writable": true
        },
        {
          "name": "oracle"
        },
        {
          "name": "calendar",
          "optional": true
        },
        {
          "name": "baseTokenProgram",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteTokenProgram",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "maxBase",
          "type": "u64"
        },
        {
          "name": "maxQuote",
          "type": "u64"
        },
        {
          "name": "minLpOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Must be the program's upgrade authority, so nobody can front-run the deploy and become admin."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program",
          "address": "AUkfc1YB8AB1BSno52xnsPvKcXYCbnHyySDxhrkmwp9x"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "admin",
          "type": "pubkey"
        },
        {
          "name": "guardian",
          "type": "pubkey"
        },
        {
          "name": "treasury",
          "type": "pubkey"
        },
        {
          "name": "protocolFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "mockAdvanceClock",
      "discriminator": [
        241,
        230,
        240,
        86,
        127,
        229,
        72,
        172
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mockOracle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  99,
                  107,
                  95,
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mockOracle.feedId",
                "account": "mockOracle"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "seconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "mockHeartbeat",
      "discriminator": [
        238,
        186,
        237,
        105,
        132,
        243,
        44,
        185
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mockOracle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  99,
                  107,
                  95,
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mockOracle.feedId",
                "account": "mockOracle"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "mockSetPrice",
      "discriminator": [
        144,
        42,
        159,
        110,
        155,
        184,
        48,
        44
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mockOracle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  99,
                  107,
                  95,
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "feedId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "feedId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "price",
          "type": "i64"
        },
        {
          "name": "conf",
          "type": "u64"
        },
        {
          "name": "expo",
          "type": "i32"
        }
      ]
    },
    {
      "name": "mockSetStatus",
      "discriminator": [
        181,
        213,
        243,
        215,
        181,
        207,
        246,
        36
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "mockOracle",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  99,
                  107,
                  95,
                  111,
                  114,
                  97,
                  99,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "mockOracle.feedId",
                "account": "mockOracle"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "status",
          "type": {
            "defined": {
              "name": "mockStatus"
            }
          }
        }
      ]
    },
    {
      "name": "setGlobalPause",
      "discriminator": [
        32,
        234,
        28,
        216,
        67,
        76,
        116,
        231
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setHalt",
      "discriminator": [
        212,
        192,
        179,
        66,
        23,
        73,
        197,
        15
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "halted",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setParams",
      "discriminator": [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "poolParams"
            }
          }
        }
      ]
    },
    {
      "name": "setSessions",
      "discriminator": [
        160,
        105,
        254,
        224,
        158,
        224,
        85,
        62
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "calendar",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "sessions",
          "type": {
            "vec": {
              "defined": {
                "name": "session"
              }
            }
          }
        },
        {
          "name": "validUntil",
          "type": "i64"
        }
      ]
    },
    {
      "name": "swap",
      "discriminator": [
        248,
        198,
        158,
        145,
        225,
        117,
        135,
        200
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "baseMint"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ]
          }
        },
        {
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "baseVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBase",
          "writable": true
        },
        {
          "name": "userQuote",
          "writable": true
        },
        {
          "name": "oracle"
        },
        {
          "name": "calendar",
          "optional": true
        },
        {
          "name": "treasuryToken",
          "docs": [
            "Treasury's token account for the input mint. Required only when protocol_fee_bps > 0."
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "baseTokenProgram",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteTokenProgram",
          "relations": [
            "pool"
          ]
        }
      ],
      "args": [
        {
          "name": "amountIn",
          "type": "u64"
        },
        {
          "name": "minAmountOut",
          "type": "u64"
        },
        {
          "name": "direction",
          "type": {
            "defined": {
              "name": "direction"
            }
          }
        }
      ]
    },
    {
      "name": "updateReference",
      "discriminator": [
        31,
        37,
        246,
        252,
        89,
        62,
        130,
        107
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true
        },
        {
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "oracle"
        },
        {
          "name": "calendar",
          "optional": true
        }
      ],
      "args": []
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "baseMint"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ]
          }
        },
        {
          "name": "baseMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "baseVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteVault",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpMint",
          "writable": true,
          "relations": [
            "pool"
          ]
        },
        {
          "name": "userBase",
          "writable": true
        },
        {
          "name": "userQuote",
          "writable": true
        },
        {
          "name": "userLp",
          "writable": true
        },
        {
          "name": "baseTokenProgram",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "quoteTokenProgram",
          "relations": [
            "pool"
          ]
        },
        {
          "name": "lpTokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "lpAmount",
          "type": "u64"
        },
        {
          "name": "minBaseOut",
          "type": "u64"
        },
        {
          "name": "minQuoteOut",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "globalConfig",
      "discriminator": [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      "name": "marketCalendar",
      "discriminator": [
        3,
        21,
        133,
        9,
        156,
        12,
        91,
        73
      ]
    },
    {
      "name": "mockOracle",
      "discriminator": [
        208,
        74,
        71,
        99,
        160,
        22,
        158,
        240
      ]
    },
    {
      "name": "pool",
      "discriminator": [
        241,
        154,
        109,
        4,
        17,
        177,
        109,
        188
      ]
    }
  ],
  "events": [
    {
      "name": "globalPauseSet",
      "discriminator": [
        62,
        169,
        2,
        80,
        213,
        238,
        159,
        57
      ]
    },
    {
      "name": "haltSet",
      "discriminator": [
        72,
        72,
        136,
        23,
        166,
        26,
        205,
        223
      ]
    },
    {
      "name": "liquidityAdded",
      "discriminator": [
        154,
        26,
        221,
        108,
        238,
        64,
        217,
        161
      ]
    },
    {
      "name": "liquidityRemoved",
      "discriminator": [
        225,
        105,
        216,
        39,
        124,
        116,
        169,
        189
      ]
    },
    {
      "name": "modeChanged",
      "discriminator": [
        149,
        123,
        78,
        29,
        237,
        72,
        67,
        229
      ]
    },
    {
      "name": "paramsUpdated",
      "discriminator": [
        2,
        163,
        138,
        99,
        135,
        11,
        136,
        169
      ]
    },
    {
      "name": "poolCreated",
      "discriminator": [
        202,
        44,
        41,
        88,
        104,
        220,
        157,
        82
      ]
    },
    {
      "name": "referenceUpdated",
      "discriminator": [
        157,
        228,
        27,
        123,
        11,
        146,
        189,
        117
      ]
    },
    {
      "name": "swapped",
      "discriminator": [
        217,
        52,
        52,
        83,
        147,
        135,
        96,
        109
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "outsideBand",
      "msg": "Trade would move the pool price outside the allowed band"
    },
    {
      "code": 6001,
      "name": "poolPaused",
      "msg": "Pool is paused: swaps and deposits are blocked, withdrawals still work"
    },
    {
      "code": 6002,
      "name": "staleOracle",
      "msg": "Oracle price is stale"
    },
    {
      "code": 6003,
      "name": "oracleConfidenceTooWide",
      "msg": "Oracle confidence interval is too wide"
    },
    {
      "code": 6004,
      "name": "wrongFeed",
      "msg": "Oracle account is for a different feed or not owned by the expected program"
    },
    {
      "code": 6005,
      "name": "slippageExceeded",
      "msg": "Output is below the minimum requested (slippage)"
    },
    {
      "code": 6006,
      "name": "tvlCapExceeded",
      "msg": "Deposit would exceed the pool's TVL cap"
    },
    {
      "code": 6007,
      "name": "insufficientLiquidity",
      "msg": "Not enough liquidity for this trade"
    },
    {
      "code": 6008,
      "name": "invalidParams",
      "msg": "Invalid parameters"
    },
    {
      "code": 6009,
      "name": "calendarExpired",
      "msg": "Market calendar has expired"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6011,
      "name": "unsupportedMintExtension",
      "msg": "Mint uses a token extension that is not supported"
    },
    {
      "code": 6012,
      "name": "unauthorized",
      "msg": "Signer is not allowed to perform this action"
    },
    {
      "code": 6013,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6014,
      "name": "invalidOraclePrice",
      "msg": "Oracle price is zero, negative, or out of range"
    },
    {
      "code": 6015,
      "name": "missingCalendar",
      "msg": "This pool needs its market calendar account"
    },
    {
      "code": 6016,
      "name": "oracleNotVerified",
      "msg": "Oracle price update is not fully verified"
    }
  ],
  "types": [
    {
      "name": "createPoolArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "profile",
            "type": {
              "defined": {
                "name": "marketProfile"
              }
            }
          },
          {
            "name": "oracleKind",
            "type": {
              "defined": {
                "name": "oracleKind"
              }
            }
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxStalenessSecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "poolParams"
              }
            }
          }
        ]
      }
    },
    {
      "name": "direction",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "baseToQuote"
          },
          {
            "name": "quoteToBase"
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "guardian",
            "type": "pubkey"
          },
          {
            "name": "protocolFeeBps",
            "type": "u16"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "globalPause",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "globalPauseSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "by",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "haltSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "by",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "liquidityAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "baseIn",
            "type": "u64"
          },
          {
            "name": "quoteIn",
            "type": "u64"
          },
          {
            "name": "lpMinted",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "liquidityRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "baseOut",
            "type": "u64"
          },
          {
            "name": "quoteOut",
            "type": "u64"
          },
          {
            "name": "lpBurned",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketCalendar",
      "docs": [
        "Explicit trading sessions for one market profile. No timezone logic on-chain: holidays, early",
        "closes, and daylight saving are baked into the timestamps by `scripts/update-calendar`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "profileId",
            "type": "u8"
          },
          {
            "name": "sessions",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "session"
                  }
                },
                48
              ]
            }
          },
          {
            "name": "sessionCount",
            "type": "u16"
          },
          {
            "name": "validUntil",
            "docs": [
              "After this time the calendar is expired and the market counts as Closed."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketProfile",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "alwaysOpen"
          },
          {
            "name": "usEquity"
          }
        ]
      }
    },
    {
      "name": "mockOracle",
      "docs": [
        "Admin-controlled price source for localnet/devnet demos. Never compiled into mainnet builds."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "expo",
            "type": "i32"
          },
          {
            "name": "publishTs",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "mockStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "clockOffset",
            "docs": [
              "Simulated time: pools on this feed run this many seconds ahead of the real clock.",
              "Only ever moves forward (`mock_advance_clock`)."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "mockStatus",
      "docs": [
        "Plain data, compiled in every build only because Anchor's IDL generator ignores `#[cfg]` on",
        "instruction argument types. The mock oracle account and instructions stay behind `devnet-mock`."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "trading"
          },
          {
            "name": "halted"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "mode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          },
          {
            "name": "paused"
          }
        ]
      }
    },
    {
      "name": "modeChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": {
              "defined": {
                "name": "mode"
              }
            }
          },
          {
            "name": "to",
            "type": {
              "defined": {
                "name": "mode"
              }
            }
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "oracleKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pyth"
          },
          {
            "name": "mock"
          }
        ]
      }
    },
    {
      "name": "paramsUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "poolParams"
              }
            }
          }
        ]
      }
    },
    {
      "name": "pool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "baseVault",
            "type": "pubkey"
          },
          {
            "name": "quoteVault",
            "type": "pubkey"
          },
          {
            "name": "lpMint",
            "type": "pubkey"
          },
          {
            "name": "baseTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "quoteTokenProgram",
            "type": "pubkey"
          },
          {
            "name": "baseDecimals",
            "type": "u8"
          },
          {
            "name": "quoteDecimals",
            "type": "u8"
          },
          {
            "name": "profile",
            "type": {
              "defined": {
                "name": "marketProfile"
              }
            }
          },
          {
            "name": "calendar",
            "type": "pubkey"
          },
          {
            "name": "oracleKind",
            "type": {
              "defined": {
                "name": "oracleKind"
              }
            }
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxStalenessSecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "params",
            "type": {
              "defined": {
                "name": "poolParams"
              }
            }
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "mode"
              }
            }
          },
          {
            "name": "halted",
            "type": "bool"
          },
          {
            "name": "poolPrice",
            "type": "u128"
          },
          {
            "name": "referencePrice",
            "type": "u128"
          },
          {
            "name": "closeTs",
            "type": "i64"
          },
          {
            "name": "lastUpdateTs",
            "type": "i64"
          },
          {
            "name": "lastOraclePublishTs",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "baseVaultBump",
            "type": "u8"
          },
          {
            "name": "quoteVaultBump",
            "type": "u8"
          },
          {
            "name": "lpMintBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "poolCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "profile",
            "type": {
              "defined": {
                "name": "marketProfile"
              }
            }
          },
          {
            "name": "oracleKind",
            "type": {
              "defined": {
                "name": "oracleKind"
              }
            }
          },
          {
            "name": "feedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "poolParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "openBandBps",
            "type": "u16"
          },
          {
            "name": "closedBaseBandBps",
            "type": "u16"
          },
          {
            "name": "closedBandGrowthBpsPerHour",
            "type": "u16"
          },
          {
            "name": "closedMaxBandBps",
            "type": "u16"
          },
          {
            "name": "openFeeBps",
            "type": "u16"
          },
          {
            "name": "closedBaseFeeBps",
            "type": "u16"
          },
          {
            "name": "closedFeeGrowthBpsPerHour",
            "type": "u16"
          },
          {
            "name": "closedMaxFeeBps",
            "type": "u16"
          },
          {
            "name": "sizeFeeBpsPer1pctDepth",
            "type": "u16"
          },
          {
            "name": "depthBps",
            "type": "u16"
          },
          {
            "name": "maxTvlQuote",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "referenceUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "referencePrice",
            "type": "u128"
          },
          {
            "name": "poolPrice",
            "type": "u128"
          },
          {
            "name": "oraclePublishTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "session",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "openTs",
            "docs": [
              "UTC seconds, inclusive."
            ],
            "type": "i64"
          },
          {
            "name": "closeTs",
            "docs": [
              "UTC seconds, exclusive."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "swapped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "direction",
            "type": {
              "defined": {
                "name": "direction"
              }
            }
          },
          {
            "name": "amountIn",
            "type": "u64"
          },
          {
            "name": "amountOut",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "protocolFee",
            "type": "u64"
          },
          {
            "name": "mode",
            "type": {
              "defined": {
                "name": "mode"
              }
            }
          },
          {
            "name": "priceBefore",
            "type": "u128"
          },
          {
            "name": "priceAfter",
            "type": "u128"
          },
          {
            "name": "referencePrice",
            "type": "u128"
          },
          {
            "name": "bandBps",
            "type": "u16"
          }
        ]
      }
    }
  ]
};
