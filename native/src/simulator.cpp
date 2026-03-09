#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <random>
#include <string>
#include <thread>
#include <algorithm>

// Native simulator for video transcoding jobs.
// Behavior:
// - Reads job parameters (CODEC, RESOLUTION, DURATION_SEC, BITRATE_K, PRIORITY, DURATION_MS) from environment
// - Computes success probability internally based on job characteristics
// - Sleeps for DURATION_MS milliseconds
// - Exits with code 0 on success, 1 on failure, based on computed probability
// Cross-platform: builds with MSVC (Windows) or g++/clang++ (Unix/macOS).

static long parseLong(const char* s, long fallback) {
    if (!s || !*s) return fallback;
    char* end = nullptr;
    long v = std::strtol(s, &end, 10);
    if (end == s) return fallback;
    return v;
}

static double parseDouble(const char* s, double fallback) {
    if (!s || !*s) return fallback;
    char* end = nullptr;
    double v = std::strtod(s, &end);
    if (end == s) return fallback;
    return v;
}

static std::string getEnvStr(const char* name, const std::string& fallback) {
    const char* val = std::getenv(name);
    return (val && *val) ? std::string(val) : fallback;
}

static std::string toLower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}

static double computeSuccessProbability(
    const std::string& codec,
    const std::string& resolution,
    double durationSec,
    long bitrateK,
    const std::string& priority
) {
    // Base probability
    double prob = 0.82;

    // Codec adjustments
    std::string c = toLower(codec);
    if (c == "av1") prob -= 0.18;
    else if (c == "h265" || c == "hevc") prob -= 0.08;

    // Resolution adjustments
    std::string r = toLower(resolution);
    if (r == "uhd" || r.find("2160") != std::string::npos || r.find("4k") != std::string::npos) {
        prob -= 0.12;
    } else if (r == "hd" || r.find("1080") != std::string::npos || r.find("720") != std::string::npos) {
        prob -= 0.03;
    }

    // Duration adjustments
    if (durationSec > 120.0) prob -= 0.1;
    else if (durationSec < 30.0) prob += 0.05;

    // Priority adjustments
    std::string p = toLower(priority);
    if (p == "high") prob += 0.04;

    // Clamp to reasonable bounds
    if (prob < 0.05) prob = 0.05;
    if (prob > 0.98) prob = 0.98;

    return prob;
}

int main() {
    // Read job parameters from environment
    const long durationMs = parseLong(std::getenv("DURATION_MS"), 500);
    const std::string codec = getEnvStr("CODEC", "h264");
    const std::string resolution = getEnvStr("RESOLUTION", "hd");
    const double durationSec = parseDouble(std::getenv("DURATION_SEC"), 45.0);
    const long bitrateK = parseLong(std::getenv("BITRATE_K"), 2500);
    const std::string priority = getEnvStr("PRIORITY", "normal");

    // Compute success probability based on job characteristics
    const double successProb = computeSuccessProbability(codec, resolution, durationSec, bitrateK, priority);

    // Sleep for the requested duration
    std::this_thread::sleep_for(std::chrono::milliseconds(durationMs));

    // Random outcome based on computed probability
    std::random_device rd;
    std::mt19937 gen(rd());
    std::bernoulli_distribution dist(successProb);
    const bool ok = dist(gen);

    return ok ? 0 : 1;
}
