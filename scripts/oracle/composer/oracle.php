<?php

// Composer oracle, run by run.sh with composer/semver pinned by composer.lock.
// Usage: php oracle.php <versions> <pairs> <requirements> <validity-out> <pairs-out> <requirements-out>
//   <expected composer/semver version>
// A version is valid if VersionParser::normalize accepts it and it is not a `dev-` branch, which
// Composer gives no order; it is written as `valid <v> <normalized>`. Each pair of valid versions is
// written as `a <op> b`, comparing the normalized versions with Comparator, as Semver::sort does. Each
// `version<TAB>constraint` row with a valid version is written as `version satisfies|fails constraint`
// (Semver::satisfies). A constraint that parseConstraints rejects is written once, as
// `version error constraint` with the first valid version.

require __DIR__ . '/vendor/autoload.php';

use Composer\InstalledVersions;
use Composer\Semver\Comparator;
use Composer\Semver\Semver;
use Composer\Semver\VersionParser;

list(, $versions, $pairs, $requirements, $validityOut, $pairsOut, $requirementsOut, $expected) = $argv;
$installed = InstalledVersions::getPrettyVersion('composer/semver');
if ($installed !== $expected) {
    fwrite(STDERR, "composer/semver $installed is installed, expected $expected\n");
    exit(1);
}

function lines($path)
{
    return file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
}

$parser = new VersionParser();
$normalized = array();
$out = fopen($validityOut, 'w');
foreach (lines($versions) as $v) {
    try {
        $n = $parser->normalize($v);
    } catch (UnexpectedValueException $e) {
        fwrite($out, "invalid $v\n");
        continue;
    }
    if (strpos($n, 'dev-') === 0) {
        fwrite($out, "invalid $v $n\n");
        continue;
    }
    $normalized[$v] = $n;
    fwrite($out, "valid $v $n\n");
}
fclose($out);

$out = fopen($pairsOut, 'w');
foreach (lines($pairs) as $line) {
    list($a, $b) = explode(' ', $line);
    if (!isset($normalized[$a], $normalized[$b])) {
        continue;
    }
    $x = $normalized[$a];
    $y = $normalized[$b];
    $op = Comparator::lessThan($x, $y) ? '<' : (Comparator::equalTo($x, $y) ? '=' : '>');
    fwrite($out, "$a $op $b\n");
}
fclose($out);

$rejected = array();
$out = fopen($requirementsOut, 'w');
foreach (lines($requirements) as $line) {
    list($v, $constraint) = explode("\t", $line);
    if (!isset($normalized[$v]) || isset($rejected[$constraint])) {
        continue;
    }
    try {
        $verdict = Semver::satisfies($v, $constraint) ? 'satisfies' : 'fails';
    } catch (UnexpectedValueException $e) {
        $verdict = 'error';
        $rejected[$constraint] = true;
    }
    fwrite($out, "$v $verdict $constraint\n");
}
fclose($out);
