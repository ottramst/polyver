# RubyGems oracle, run by run.sh with the RubyGems bundled in the pinned Ruby image.
# Usage: ruby gem.rb <versions> <pairs> <requirements> <validity-out> <pairs-out> <requirements-out>
# A version is valid if Gem::Version.correct? accepts it; each pair of valid versions is written as
# `a <op> b`. Each `version<TAB>requirement` row with a valid version is written as
# `version satisfies|fails requirement`, splitting the requirement at `,` as a Gemfile lists it.
require "rubygems/version"
require "rubygems/requirement"

versions, pairs, requirements, validity_out, pairs_out, requirements_out = ARGV
valid = {}
File.open(validity_out, "w") do |out|
  File.foreach(versions, chomp: true) do |v|
    valid[v] = Gem::Version.correct?(v)
    out.puts "#{valid[v] ? "valid" : "invalid"} #{v}"
  end
end

File.open(pairs_out, "w") do |out|
  File.foreach(pairs, chomp: true) do |line|
    a, b = line.split(" ")
    next unless valid[a] && valid[b]
    op = { -1 => "<", 0 => "=", 1 => ">" }.fetch(Gem::Version.new(a) <=> Gem::Version.new(b))
    out.puts "#{a} #{op} #{b}"
  end
end

File.open(requirements_out, "w") do |out|
  File.foreach(requirements, chomp: true) do |line|
    v, req = line.split("\t")
    next unless valid[v]
    ok = Gem::Requirement.new(*req.split(",")).satisfied_by?(Gem::Version.new(v))
    out.puts "#{v} #{ok ? "satisfies" : "fails"} #{req}"
  end
end
