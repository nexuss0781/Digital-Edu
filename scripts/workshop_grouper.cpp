#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <algorithm>
#include <sstream>
#include <cctype>

namespace fs = std::filesystem;

struct StepFile {
    std::string id;
    std::string title;
    std::string path;
    std::string name;
    int step_number = 0;
};

struct WorkshopGroup {
    std::string parent_id;
    std::string title;
    std::string directory_path;
    std::vector<StepFile> steps;
};

std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

std::string escape_json(const std::string& s) {
    std::string out;
    for (char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c;
        }
    }
    return out;
}

std::string to_lower(const std::string& s) {
    std::string out = s;
    for (auto& c : out) c = std::tolower(c);
    return out;
}

int extract_step_number(const std::string& name) {
    size_t pos = 0;
    int part = 0;
    try {
        part = std::stoi(name, &pos);
        std::string after = name.substr(pos);
        if (!after.empty() && after[0] == '.') {
            after = after.substr(1);
            int n2 = std::stoi(after, &pos);
            after = after.substr(pos);
            if (!after.empty() && after[0] == '.') {
                after = after.substr(1);
                int step = std::stoi(after, &pos);
                return step;
            }
        }
    } catch (...) {}
    auto sp = name.find("step ");
    if (sp != std::string::npos) {
        try { return std::stoi(name.substr(sp + 5)); } catch (...) {}
    }
    return 999999;
}

std::string extract_workshop_name(const std::string& path) {
    auto p = path.find("workshop-");
    if (p == std::string::npos) return "";
    std::string after = path.substr(p + 9);
    std::string name;
    for (char c : after) {
        if (c == '.' || c == '/') break;
        name += c;
    }
    if (!name.empty() && name.back() == '-') name.pop_back();
    auto dot = name.rfind(".md");
    if (dot != std::string::npos) name = name.substr(0, dot);
    if (!name.empty() && name.back() == '-') name.pop_back();
    return name;
}

int main(int argc, char* argv[]) {
    std::string courses_dir = "courses";
    std::string output_file = "workshop_groups.json";
    if (argc > 1) courses_dir = argv[1];
    if (argc > 2) output_file = argv[2];

    fs::path root = fs::absolute(courses_dir);
    if (!fs::exists(root)) {
        std::cerr << "ERROR: courses dir not found: " << root << std::endl;
        return 1;
    }

    int total_files = 0, md_files = 0, workshop_files = 0;
    std::map<std::string, std::vector<StepFile>> grouped;

    for (auto& p : fs::recursive_directory_iterator(root)) {
        if (!p.is_regular_file()) continue;
        total_files++;
        auto ext = p.path().extension().string();
        if (to_lower(ext) != ".md") continue;
        md_files++;

        std::ifstream f(p.path());
        std::string line;
        if (!std::getline(f, line)) continue;
        if (line.find("---") != 0) continue;

        std::string id, title, type;
        while (std::getline(f, line)) {
            if (line.find("---") == 0) break;
            if (line.find("id:") == 0) id = trim(line.substr(3));
            else if (line.find("title:") == 0) title = trim(line.substr(6));
            else if (line.find("type:") == 0) type = trim(line.substr(5));
        }

        if (to_lower(type) != "workshop") continue;
        workshop_files++;

        std::string rel_path = fs::relative(p.path(), root).string();
        std::string stem = p.path().stem().string();

        StepFile sf;
        sf.id = id;
        sf.title = title.empty() ? stem : title;
        sf.path = rel_path;
        sf.name = stem;
        sf.step_number = extract_step_number(stem);

        std::string ws_name = extract_workshop_name(rel_path);
        if (ws_name.empty()) ws_name = stem;
        std::string dir = fs::path(rel_path).parent_path().string();
        std::string group_key = dir + "/" + ws_name;
        grouped[group_key].push_back(sf);
    }

    std::vector<std::pair<std::string, WorkshopGroup>> group_list;

    for (auto& [name, files] : grouped) {
        std::sort(files.begin(), files.end(), [](const StepFile& a, const StepFile& b) {
            return a.step_number < b.step_number;
        });

        WorkshopGroup g;
        g.title = name;
        for (auto& c : g.title) if (c == '-') c = ' ';
        bool cap = true;
        for (auto& c : g.title) {
            if (cap && std::isalpha(c)) { c = std::toupper(c); cap = false; }
            else if (c == ' ') cap = true;
        }

        auto first_id = files[0].id;
        auto pos = first_id.find_last_of('/');
        g.parent_id = (pos != std::string::npos) ? first_id.substr(0, pos) : "workshop-" + name;

        auto first_path = fs::path(files[0].path);
        g.directory_path = first_path.parent_path().string();
        g.steps = files;

        group_list.push_back({name, g});
    }

    std::sort(group_list.begin(), group_list.end(),
        [](const auto& a, const auto& b) { return a.first < b.first; });

    std::ofstream out(output_file);
    out << "{\n";
    out << "  \"workshop_groups\": [\n";

    for (size_t gi = 0; gi < group_list.size(); ++gi) {
        auto& g = group_list[gi].second;
        out << "    {\n";
        out << "      \"parent_id\": \"" << escape_json(g.parent_id) << "\",\n";
        out << "      \"title\": \"" << escape_json(g.title) << "\",\n";
        out << "      \"step_count\": " << g.steps.size() << ",\n";
        out << "      \"directory_path\": \"" << escape_json(g.directory_path) << "\",\n";
        out << "      \"steps\": [\n";

        for (size_t si = 0; si < g.steps.size(); ++si) {
            auto& sf = g.steps[si];
            out << "        {\n";
            out << "          \"id\": \"" << escape_json(sf.id) << "\",\n";
            out << "          \"title\": \"" << escape_json(sf.title) << "\",\n";
            out << "          \"name\": \"" << escape_json(sf.name) << "\",\n";
            out << "          \"path\": \"" << escape_json(sf.path) << "\",\n";
            out << "          \"step_number\": " << sf.step_number << ",\n";
            out << "          \"parent_id\": \"" << escape_json(g.parent_id) << "\"\n";
            out << "        }";
            if (si < g.steps.size() - 1) out << ",";
            out << "\n";
        }

        out << "      ]\n";
        out << "    }";
        if (gi < group_list.size() - 1) out << ",";
        out << "\n";
    }

    out << "  ]\n";
    out << "}\n";
    out.close();

    std::cout << "Files scanned: " << total_files
              << ", MD: " << md_files
              << ", Workshop: " << workshop_files
              << ", Groups: " << group_list.size() << std::endl;

    return 0;
}
