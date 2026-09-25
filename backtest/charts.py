"""PNG charts for the results page and README. Colors: dataviz reference palette slots 1-2 (validated:
CVD dE 24.7, normal-vision dE 33.6, both >= 3:1 on the light surface). Identity is never color-only:
there's a legend, and the text names both pools."""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE, INK, INK_2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
PLAIN, AFTERBELL = "#2a78d6", "#eb6834"  # categorical slots 1, 2 (fixed order)
LABELS = {"plain": "Normal pool (x·y=k)", "afterbell": "Afterbell"}


def _style(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=INK_2, labelsize=9, length=0)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def lp_vs_hodl(results: dict, path: Path):
    events = results["events"]
    fig, ax = plt.subplots(figsize=(9, 8.5), dpi=150, facecolor=SURFACE)
    _style(ax)
    h = 0.36
    for i, e in enumerate(events):
        y = len(events) - 1 - i
        ax.barh(y + h / 2 + 0.02, e["plain"]["lpVsHodlPct"], height=h, color=PLAIN)
        ax.barh(y - h / 2 - 0.02, e["afterbell"]["lpVsHodlPct"], height=h, color=AFTERBELL)
    ax.set_yticks(
        range(len(events)),
        [f"{e['ticker']} {e['monday']}  ({e['gapPct']:+.1f}%)" for e in reversed(events)],
        color=INK,
    )
    ax.set_xlabel("LP value vs. just holding, at Monday's open (%)", color=INK_2, fontsize=9)
    ax.set_title(
        "LP result over the 20 largest weekend gaps (2021 to today)",
        loc="left",
        color=INK,
        fontsize=12,
        fontweight="bold",
        pad=40,
    )
    s = results["summary"]
    ax.text(
        0,
        1.012,
        f"In total, Afterbell LPs lose {s['lossReductionPct']:.0f}% less than normal-pool LPs.\n"
        "Worst case: the trader knows Monday's open price all weekend.",
        transform=ax.transAxes,
        color=INK_2,
        fontsize=9,
    )
    ax.legend(
        [plt.Rectangle((0, 0), 1, 1, color=PLAIN), plt.Rectangle((0, 0), 1, 1, color=AFTERBELL)],
        [LABELS["plain"], LABELS["afterbell"]],
        loc="lower left",
        frameon=False,
        fontsize=9,
        labelcolor=INK,
    )
    ax.axvline(0, color=INK_2, linewidth=0.8)
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)


def loss_vs_gap(results: dict, path: Path):
    events = sorted(results["events"], key=lambda e: abs(e["gapPct"]))
    gaps = [abs(e["gapPct"]) for e in events]
    band = results["events"][0]["afterbell"]["bandAtOpenBps"] / 100
    fig, ax = plt.subplots(figsize=(9, 5), dpi=150, facecolor=SURFACE)
    _style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    # Dots, not lines: loss isn't a smooth function of gap size (up and down moves differ).
    for key, color in (("plain", PLAIN), ("afterbell", AFTERBELL)):
        ys = [-e[key]["lpVsHodlPct"] for e in events]
        ax.scatter(gaps, ys, s=36, color=color, edgecolors=SURFACE, linewidths=1.5, label=LABELS[key], zorder=3)
        ax.annotate(LABELS[key], (gaps[-1], ys[-1]), xytext=(8, 0), textcoords="offset points",
                    color=INK, fontsize=9, va="center")
    ax.set_xlim(0, max(gaps) * 1.18)
    ax.set_ylim(bottom=0)
    ax.axvline(band, color=INK_2, linewidth=1, linestyle=(0, (4, 3)))
    ax.text(band, ax.get_ylim()[1] * 0.5, f" Afterbell band\n by Monday: ±{band:.2f}%", color=INK_2, fontsize=9, va="center")
    ax.set_xlabel("Weekend gap, Friday close to Monday open (absolute %)", color=INK_2, fontsize=9)
    ax.set_ylabel("LP loss vs. holding (%)", color=INK_2, fontsize=9)
    ax.set_title("Bigger gaps hurt LPs more; Afterbell's band caps how far the price can be pushed",
                 loc="left", color=INK, fontsize=12, fontweight="bold")
    ax.legend(loc="lower right", frameon=False, fontsize=9, labelcolor=INK)
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)
