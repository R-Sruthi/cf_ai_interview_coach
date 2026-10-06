// Hard-coded problem bank. Topic names are the only values that can ever
// reach weak_topics, since the grader's schema is built from problem.topics.

export const TOPICS = [
  "arrays",
  "hashing",
  "two-pointers",
  "sliding-window",
  "binary-search",
  "stacks",
  "linked-lists",
  "trees",
  "graphs",
  "heaps",
  "dynamic-programming",
  "greedy",
  "backtracking"
] as const;

export type Topic = (typeof TOPICS)[number];

// A topic counts as weak while its average score is below this.
export const WEAK_THRESHOLD = 7;
export type Difficulty = "easy" | "medium" | "hard";

export interface Problem {
  id: string;
  title: string;
  difficulty: Difficulty;
  topics: [Topic, ...Topic[]];
  statement: string;
}

export const PROBLEMS: Problem[] = [
  {
    id: "two-sum",
    title: "Two Sum",
    difficulty: "easy",
    topics: ["arrays", "hashing"],
    statement:
      "Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`. Exactly one solution exists and you may not use the same element twice."
  },
  {
    id: "valid-anagram",
    title: "Valid Anagram",
    difficulty: "easy",
    topics: ["hashing"],
    statement:
      "Given two strings `s` and `t`, return true if `t` is an anagram of `s`, and false otherwise."
  },
  {
    id: "valid-palindrome",
    title: "Valid Palindrome",
    difficulty: "easy",
    topics: ["two-pointers"],
    statement:
      "Given a string `s`, return true if it is a palindrome after converting all uppercase letters to lowercase and removing all non-alphanumeric characters."
  },
  {
    id: "best-time-stock",
    title: "Best Time to Buy and Sell Stock",
    difficulty: "easy",
    topics: ["arrays", "greedy"],
    statement:
      "Given an array `prices` where `prices[i]` is the price of a stock on day `i`, return the maximum profit from buying on one day and selling on a later day. Return 0 if no profit is possible."
  },
  {
    id: "valid-parentheses",
    title: "Valid Parentheses",
    difficulty: "easy",
    topics: ["stacks"],
    statement:
      "Given a string containing only the characters `()[]{}`, determine whether every opening bracket is closed by the same type of bracket in the correct order."
  },
  {
    id: "reverse-linked-list",
    title: "Reverse Linked List",
    difficulty: "easy",
    topics: ["linked-lists"],
    statement:
      "Given the head of a singly linked list, reverse the list and return the new head."
  },
  {
    id: "binary-search",
    title: "Binary Search",
    difficulty: "easy",
    topics: ["binary-search", "arrays"],
    statement:
      "Given a sorted array of distinct integers `nums` and a `target`, return the index of `target` or -1 if it is not present. Your algorithm must run in O(log n)."
  },
  {
    id: "max-depth-tree",
    title: "Maximum Depth of Binary Tree",
    difficulty: "easy",
    topics: ["trees"],
    statement:
      "Given the root of a binary tree, return its maximum depth: the number of nodes along the longest path from the root down to a leaf."
  },
  {
    id: "longest-substring-no-repeat",
    title: "Longest Substring Without Repeating Characters",
    difficulty: "medium",
    topics: ["sliding-window", "hashing"],
    statement:
      "Given a string `s`, find the length of the longest substring that contains no repeating characters."
  },
  {
    id: "three-sum",
    title: "3Sum",
    difficulty: "medium",
    topics: ["two-pointers", "arrays"],
    statement:
      "Given an integer array `nums`, return all unique triplets `[a, b, c]` such that `a + b + c == 0`. The answer must not contain duplicate triplets."
  },
  {
    id: "group-anagrams",
    title: "Group Anagrams",
    difficulty: "medium",
    topics: ["hashing"],
    statement:
      "Given an array of strings, group the anagrams together. You may return the groups in any order."
  },
  {
    id: "search-rotated-array",
    title: "Search in Rotated Sorted Array",
    difficulty: "medium",
    topics: ["binary-search"],
    statement:
      "A sorted array of distinct integers has been rotated at an unknown pivot. Given the array and a `target`, return its index or -1, in O(log n) time."
  },
  {
    id: "daily-temperatures",
    title: "Daily Temperatures",
    difficulty: "medium",
    topics: ["stacks", "arrays"],
    statement:
      "Given an array `temperatures`, return an array `answer` where `answer[i]` is the number of days after day `i` until a warmer temperature. Use 0 if there is no future warmer day."
  },
  {
    id: "lru-cache",
    title: "LRU Cache",
    difficulty: "medium",
    topics: ["linked-lists", "hashing"],
    statement:
      "Design a data structure for a Least Recently Used cache with a fixed capacity, supporting `get(key)` and `put(key, value)` in O(1) average time each."
  },
  {
    id: "level-order-traversal",
    title: "Binary Tree Level Order Traversal",
    difficulty: "medium",
    topics: ["trees", "graphs"],
    statement:
      "Given the root of a binary tree, return the values of its nodes level by level, from left to right."
  },
  {
    id: "number-of-islands",
    title: "Number of Islands",
    difficulty: "medium",
    topics: ["graphs"],
    statement:
      "Given an m x n grid of '1's (land) and '0's (water), return the number of islands. An island is formed by connecting adjacent land cells horizontally or vertically."
  },
  {
    id: "course-schedule",
    title: "Course Schedule",
    difficulty: "medium",
    topics: ["graphs"],
    statement:
      "There are `numCourses` courses and a list of prerequisite pairs `[a, b]` meaning you must take `b` before `a`. Return true if it is possible to finish all courses."
  },
  {
    id: "kth-largest",
    title: "Kth Largest Element in an Array",
    difficulty: "medium",
    topics: ["heaps", "arrays"],
    statement:
      "Given an integer array `nums` and an integer `k`, return the kth largest element. Can you do better than sorting the whole array?"
  },
  {
    id: "coin-change",
    title: "Coin Change",
    difficulty: "medium",
    topics: ["dynamic-programming"],
    statement:
      "Given coin denominations `coins` and a total `amount`, return the fewest number of coins needed to make up that amount, or -1 if it cannot be made. You have unlimited coins of each kind."
  },
  {
    id: "house-robber",
    title: "House Robber",
    difficulty: "medium",
    topics: ["dynamic-programming"],
    statement:
      "Given an array `nums` of money in each house along a street, return the maximum you can rob without robbing two adjacent houses."
  },
  {
    id: "subsets",
    title: "Subsets",
    difficulty: "medium",
    topics: ["backtracking"],
    statement:
      "Given an integer array of unique elements, return all possible subsets (the power set). The solution must not contain duplicate subsets."
  },
  {
    id: "merge-k-sorted-lists",
    title: "Merge k Sorted Lists",
    difficulty: "hard",
    topics: ["heaps", "linked-lists"],
    statement:
      "Given an array of `k` linked lists, each sorted in ascending order, merge them into one sorted linked list and return it."
  },
  {
    id: "min-window-substring",
    title: "Minimum Window Substring",
    difficulty: "hard",
    topics: ["sliding-window", "hashing"],
    statement:
      "Given strings `s` and `t`, return the minimum window substring of `s` that contains every character of `t` (including duplicates). Return an empty string if no such window exists."
  },
  {
    id: "trapping-rain-water",
    title: "Trapping Rain Water",
    difficulty: "hard",
    topics: ["two-pointers", "stacks"],
    statement:
      "Given `n` non-negative integers representing an elevation map where each bar has width 1, compute how much water it can trap after raining."
  },
  {
    id: "n-queens",
    title: "N-Queens",
    difficulty: "hard",
    topics: ["backtracking"],
    statement:
      "Place `n` queens on an n x n chessboard so that no two queens attack each other. Return all distinct solutions."
  }
];

export function getProblem(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id);
}
