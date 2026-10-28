// Maven oracle, run by run.sh with maven-artifact on the class path (java Oracle.java, no build step).
// Usage: java -cp maven-artifact.jar Oracle.java <versions> <pairs> <validity-out> <pairs-out>
// A version is valid if ComparableVersion accepts it (it rejects only versions over 256 characters);
// each pair of valid versions is written as `a <op> b`.
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.apache.maven.artifact.versioning.ComparableVersion;

public class Oracle {
    public static void main(String[] args) throws Exception {
        Map<String, ComparableVersion> parsed = new HashMap<>();
        StringBuilder validity = new StringBuilder();
        for (String v : Files.readAllLines(Path.of(args[0]))) {
            try {
                parsed.put(v, new ComparableVersion(v));
                validity.append("valid ").append(v).append('\n');
            } catch (IllegalArgumentException e) {
                validity.append("invalid ").append(v).append('\n');
            }
        }
        Files.writeString(Path.of(args[2]), validity);

        StringBuilder pairs = new StringBuilder();
        for (String line : Files.readAllLines(Path.of(args[1]))) {
            String[] ab = line.split(" ");
            ComparableVersion a = parsed.get(ab[0]);
            ComparableVersion b = parsed.get(ab[1]);
            if (a == null || b == null) continue;
            int c = a.compareTo(b);
            pairs.append(ab[0]).append(c < 0 ? " < " : c == 0 ? " = " : " > ").append(ab[1]).append('\n');
        }
        Files.writeString(Path.of(args[3]), pairs);
    }
}
