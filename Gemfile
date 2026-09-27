source "https://rubygems.org"

# Same Jekyll + plugin versions GitHub Pages uses to build the live site.
gem "github-pages", group: :jekyll_plugins

# Needed for `jekyll serve` on Ruby 3.x
gem "webrick", "~> 1.8"
gem "csv"
gem "base64"
gem "bigdecimal"

# Windows has no zoneinfo database
platforms :windows, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end
