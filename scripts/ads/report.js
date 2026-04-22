#!/usr/bin/env node
/**
 * Pull Google Ads performance for the last 7 days.
 * Usage: node scripts/ads/report.js [--days 30]
 */
import { readEnv, getAccessToken, adsQuery } from './util.js';

const days = parseInt(process.argv[process.argv.indexOf('--days') + 1]) || 7;
const period = days === 7 ? 'LAST_7_DAYS' : days === 30 ? 'LAST_30_DAYS' : 'LAST_7_DAYS';

const env = readEnv();
const token = await getAccessToken(env);

const campaigns = await adsQuery(env, token, `
  SELECT
    campaign.id,
    campaign.name,
    campaign.status,
    campaign_budget.amount_micros,
    metrics.cost_micros,
    metrics.clicks,
    metrics.impressions,
    metrics.conversions,
    metrics.ctr,
    metrics.average_cpc
  FROM campaign
  WHERE segments.date DURING ${period}
  ORDER BY metrics.cost_micros DESC
`);

const keywords = await adsQuery(env, token, `
  SELECT
    ad_group_criterion.keyword.text,
    ad_group_criterion.keyword.match_type,
    metrics.cost_micros,
    metrics.clicks,
    metrics.impressions,
    metrics.conversions
  FROM keyword_view
  WHERE segments.date DURING ${period}
    AND metrics.impressions > 0
  ORDER BY metrics.cost_micros DESC
  LIMIT 20
`);

console.log(`\n=== Google Ads Performance (Last ${days} Days) ===\n`);

if (campaigns.length === 0) {
  console.log('No campaign data found for this period.');
} else {
  let totalSpend = 0;
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalConversions = 0;

  for (const row of campaigns) {
    const c = row.campaign;
    const b = row.campaignBudget;
    const m = row.metrics;
    const spend = (m.costMicros ?? 0) / 1e6;
    const budget = (b?.amountMicros ?? 0) / 1e6;
    const clicks = m.clicks ?? 0;
    const impr = m.impressions ?? 0;
    const conv = m.conversions ?? 0;
    const ctr = ((m.ctr ?? 0) * 100).toFixed(2);
    const cpc = ((m.averageCpc ?? 0) / 1e6).toFixed(2);

    totalSpend += spend;
    totalClicks += clicks;
    totalImpressions += impr;
    totalConversions += conv;

    console.log(`Campaign: ${c.name} [${c.status}]`);
    console.log(`  Daily budget: $${budget.toFixed(2)} | Spend: $${spend.toFixed(2)}`);
    console.log(`  Clicks: ${clicks} | Impressions: ${impr} | CTR: ${ctr}%`);
    console.log(`  Avg CPC: $${cpc} | Conversions: ${conv}`);
    console.log('');
  }

  console.log('--- TOTALS ---');
  console.log(`  Total spend:       $${totalSpend.toFixed(2)}`);
  console.log(`  Total clicks:      ${totalClicks}`);
  console.log(`  Total impressions: ${totalImpressions}`);
  console.log(`  Total conversions: ${totalConversions}`);
  const cpl = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : 'N/A';
  console.log(`  Cost per lead:     $${cpl}`);
}

if (keywords.length > 0) {
  console.log('\n--- TOP KEYWORDS ---');
  for (const row of keywords) {
    const k = row.adGroupCriterion.keyword;
    const m = row.metrics;
    const spend = ((m.costMicros ?? 0) / 1e6).toFixed(2);
    console.log(`  [${k.matchType}] "${k.text}" — $${spend} spend, ${m.clicks ?? 0} clicks, ${m.conversions ?? 0} conv`);
  }
}
