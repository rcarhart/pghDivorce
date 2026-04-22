#!/usr/bin/env node
/**
 * Manage Google Ads campaigns.
 *
 * Usage:
 *   node scripts/ads/manage.js list
 *   node scripts/ads/manage.js pause --campaign "Campaign Name"
 *   node scripts/ads/manage.js enable --campaign "Campaign Name"
 *   node scripts/ads/manage.js budget --campaign "Campaign Name" --amount 50
 */
import { readEnv, getAccessToken, adsQuery, adsMutate } from './util.js';

const [,, command, ...args] = process.argv;
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const env = readEnv();
const token = await getAccessToken(env);

async function listCampaigns() {
  const results = await adsQuery(env, token, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.resource_name,
      campaign_budget.resource_name,
      campaign_budget.amount_micros
    FROM campaign
    ORDER BY campaign.name
  `);

  console.log('\n=== Campaigns ===\n');
  for (const row of results) {
    const c = row.campaign;
    const b = row.campaignBudget;
    const budget = ((b?.amountMicros ?? 0) / 1e6).toFixed(2);
    console.log(`[${c.status}] ${c.name}`);
    console.log(`  ID: ${c.id} | Daily budget: $${budget}`);
    console.log(`  Resource: ${c.resourceName}`);
    console.log('');
  }
  return results;
}

async function findCampaign(name) {
  const results = await adsQuery(env, token, `
    SELECT
      campaign.id,
      campaign.name,
      campaign.resource_name,
      campaign_budget.resource_name,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.name = '${name.replace(/'/g, "\\'")}'
    LIMIT 1
  `);
  if (!results.length) {
    console.error(`Campaign not found: "${name}"`);
    console.error('Run "list" to see available campaigns.');
    process.exit(1);
  }
  return results[0];
}

if (command === 'list') {
  await listCampaigns();

} else if (command === 'pause' || command === 'enable') {
  const name = getArg('--campaign');
  if (!name) { console.error('--campaign required'); process.exit(1); }

  const row = await findCampaign(name);
  const status = command === 'pause' ? 'PAUSED' : 'ENABLED';

  await adsMutate(env, token, 'campaigns', [{
    update: { resourceName: row.campaign.resourceName, status },
    updateMask: 'status',
  }]);

  console.log(`\n✓ Campaign "${name}" set to ${status}`);

} else if (command === 'budget') {
  const name = getArg('--campaign');
  const amount = parseFloat(getArg('--amount'));
  if (!name) { console.error('--campaign required'); process.exit(1); }
  if (isNaN(amount) || amount <= 0) { console.error('--amount must be a positive number (daily budget in USD)'); process.exit(1); }

  const row = await findCampaign(name);
  const amountMicros = Math.round(amount * 1e6);

  await adsMutate(env, token, 'campaignBudgets', [{
    update: { resourceName: row.campaignBudget.resourceName, amountMicros },
    updateMask: 'amount_micros',
  }]);

  console.log(`\n✓ Campaign "${name}" daily budget set to $${amount.toFixed(2)}`);

} else {
  console.log('Commands: list | pause | enable | budget');
  console.log('Examples:');
  console.log('  node scripts/ads/manage.js list');
  console.log('  node scripts/ads/manage.js pause --campaign "Divorce Lawyers Pittsburgh"');
  console.log('  node scripts/ads/manage.js budget --campaign "Divorce Lawyers Pittsburgh" --amount 75');
}
