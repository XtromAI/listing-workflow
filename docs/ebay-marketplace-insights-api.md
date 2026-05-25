# eBay Marketplace Insights API — Access & Notes

## What It Does

The Marketplace Insights API returns **sold/completed listing data** for pricing comps. It powers the `ebay_search_listings` tool with `soldOnly: true`.

The same tool with `soldOnly: false` uses the Browse API (already approved) and returns active listings instead.

## Access Status

- **Browse API** (`soldOnly: false`) — ✅ Approved and working
- **Marketplace Insights API** (`soldOnly: true`) — ❌ Not approved; requires Application Growth Check

## How to Request Access

1. Log into [developer.ebay.com](https://developer.ebay.com)
2. Navigate to **Grow → Application Growth Check**
   - Direct URL: `https://developer.ebay.com/grow/application-growth-check`
3. Submit the form describing your use case (e.g. sold comp lookups for resale pricing)
4. eBay reviews manually — no guaranteed timeline or approval

## Important Caveats

- The Marketplace Insights API is **restricted** and eBay has noted it is "not open to new users at this time" in developer community posts
- Approval is not guaranteed
- Reviews are done manually by the eBay team

## Fallback Behavior

If the Marketplace Insights API is unavailable, `ebay_search_listings` with `soldOnly: false` returns active listings via the Browse API. This is still useful for pricing — active listing prices often reflect market value more reliably than auction hammer prices, which can be artificially low.

## References

- [Application Growth Check](https://developer.ebay.com/grow/application-growth-check)
- [Restricted API access guide](https://developer.ebay.com/api-docs/static/gs_use-the-application-growth.html)
- [Marketplace Insights API overview](https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html)
- [eBay Developer Technical Support](https://developer.ebay.com/my/support/tickets)
