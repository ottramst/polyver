// Go oracle, run by run.sh with golang.org/x/mod pinned in go.mod.
// Usage: go run . <versions> <pairs> <validity-out> <pairs-out>
// A version is valid if semver.IsValid accepts it; each pair of valid versions is written as
// `a <op> b` using semver.Compare.
package main

import (
	"bufio"
	"os"
	"strings"

	"golang.org/x/mod/semver"
)

func lines(path string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	return strings.Split(strings.TrimRight(string(data), "\n"), "\n")
}

func create(path string) (*os.File, *bufio.Writer) {
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	return f, bufio.NewWriter(f)
}

func main() {
	valid := map[string]bool{}
	f, w := create(os.Args[3])
	for _, v := range lines(os.Args[1]) {
		valid[v] = semver.IsValid(v)
		if valid[v] {
			w.WriteString("valid " + v + "\n")
		} else {
			w.WriteString("invalid " + v + "\n")
		}
	}
	w.Flush()
	f.Close()

	f, w = create(os.Args[4])
	for _, line := range lines(os.Args[2]) {
		a, b, _ := strings.Cut(line, " ")
		if !valid[a] || !valid[b] {
			continue
		}
		op := map[int]string{-1: " < ", 0: " = ", 1: " > "}[semver.Compare(a, b)]
		w.WriteString(a + op + b + "\n")
	}
	w.Flush()
	f.Close()
}
