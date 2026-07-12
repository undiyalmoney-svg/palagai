# Poll Board Implementation Plan

## Overview
Add a new board type called "Poll Board" that allows users to create polls with multiple options and collect votes from viewers.

---

## 1. Data Structure

### Extended Board Interface
```typescript
export interface Board {
  // ... existing fields ...
  boardType?: 'standard' | 'poll'; // New field to distinguish board types
  pollData?: PollData; // Poll-specific data (only present if boardType === 'poll')
}

export interface PollData {
  question: string; // The poll question
  options: PollOption[]; // Array of poll options
  pollType: 'single' | 'multiple'; // Single choice or multiple choice
  showResults: 'always' | 'after-vote' | 'never'; // When to show results
  allowVoteChange: boolean; // Can users change their vote?
  totalVotes: number; // Total number of votes cast
  createdAt: number; // When poll was created
  endDate?: number; // Optional end date for poll
}

export interface PollOption {
  id: string; // Unique ID for the option
  text: string; // Option text
  voteCount: number; // Number of votes for this option
  color?: string; // Optional color for visual distinction
}

export interface PollVote {
  boardKey: string; // Board ID
  optionIds: string[]; // Selected option IDs (array for multiple choice)
  ip: string; // Voter IP (for tracking)
  timestamp: number; // When vote was cast
}
```

### Firebase Structure
```
/boards/{boardKey}
  - ... existing board fields ...
  - boardType: "poll"
  - pollData: {
      question: "What's your favorite color?",
      options: [
        { id: "opt1", text: "Red", voteCount: 5 },
        { id: "opt2", text: "Blue", voteCount: 3 }
      ],
      pollType: "single",
      showResults: "after-vote",
      allowVoteChange: false,
      totalVotes: 8
    }

/pollVotes/{voteId}
  - boardKey: "PAL-ABC123-XYZ789"
  - optionIds: ["opt1"]
  - ip: "192.168.1.1"
  - timestamp: 1234567890
```

---

## 2. User Flow

### 2.1 Creating a Poll Board
1. User goes to mainboard
2. User clicks "Create Poll" button (new button in toolbar)
3. Dialog opens with poll creation form:
   - Poll question input
   - Add/remove options (minimum 2, maximum 5)
   - Select poll type (single/multiple choice)
   - Show results option (always/after-vote/never)
   - Allow vote change toggle
   - Optional end date
4. User saves poll
5. Board is converted to poll board type
6. Mainboard shows poll editor instead of HTML editor

### 2.2 Viewing a Poll Board
1. User visits board URL (subboard view)
2. System detects `boardType === 'poll'`
3. If board is protected, check authorization (same as existing board protection)
4. Shows poll interface instead of HTML content:
   - Poll question displayed prominently
   - List of options with vote buttons
   - If user hasn't voted: Show voting interface
   - If user has voted: Show results (if enabled)
   - Real-time vote count updates

### 2.4 Poll Creator Analytics Page
1. Poll creator (board owner) logs into mainboard
2. If board is a poll board, show "View Poll Results" button
3. Navigate to dedicated poll analytics page (`/poll/{boardKey}/results`)
4. Display detailed vote analytics:
   - Total votes count
   - Votes per option with percentages
   - Visual charts/graphs
   - Vote history/timeline (optional)
   - Export results (optional)

### 2.3 Voting on a Poll
1. User selects option(s) based on poll type
2. User clicks "Submit Vote" button
3. System checks if user already voted (localStorage + IP)
4. If allowed, vote is recorded
5. Vote counts update in real-time
6. Results shown (if `showResults === 'after-vote'`)

---

## 3. UI Components

### 3.1 Mainboard - Poll Creation/Editing
**Location**: `mainboard.html` and `mainboard.ts`

**New Features**:
- Toggle between "Standard Board" and "Poll Board" mode
- Poll editor component (replaces HTML editor when in poll mode)
- Poll question input field
- Dynamic option list (add/remove options, max 5)
- Poll settings panel
- Board protection toggle (reuse existing)
- "View Poll Results" button (only for poll boards)

**UI Elements**:
```
[Toggle: Standard Board / Poll Board]

Poll Question:
[Text Input: "What's your favorite color?"]

Options:
  [Option 1: "Red"        ] [Remove]
  [Option 2: "Blue"       ] [Remove]
  [Option 3: "Green"      ] [Remove]
  [+ Add Option] (disabled if 5 options)

Poll Settings:
  ○ Single Choice  ● Multiple Choice
  Show Results: [Dropdown: Always / After Vote / Never]
  ☑ Allow users to change their vote
  End Date: [Optional date picker]

Board Protection:
  ☑ Board Protection (same as existing)
  [Manage Authorized Emails] (if enabled)

[Save Poll] [Clear Poll] [View Poll Results] (if poll exists)
```

### 3.2 Subboard - Poll Display & Voting
**Location**: `subboard.html` and `subboard.ts`

**New Features**:
- Detect poll board type
- Check board protection before allowing votes
- Render poll interface instead of HTML content
- Voting interface
- Results display with percentages and bars

**UI Elements**:
```
Poll Question Display:
"What's your favorite color?"

Voting Interface (if not voted):
  ○ Red
  ○ Blue  
  ○ Green
  [Submit Vote]

Results Display (if voted or showResults === 'always'):
  Red:    ████████████ 50% (5 votes)
  Blue:   ██████       30% (3 votes)
  Green:  ████         20% (2 votes)
  
  Total Votes: 10
```

### 3.3 Poll Analytics Page (Creator Only)
**Location**: `poll-results/poll-results.component.ts` (new component)

**New Features**:
- Dedicated page for poll creators to view detailed results
- Accessible only to board owner
- Route: `/poll/{boardKey}/results`
- Link from mainboard when viewing poll board

**UI Elements**:
```
Poll Analytics Page

Poll Question: "What's your favorite color?"

Total Votes: 10

Detailed Results:
┌─────────────────────────────────────┐
│ Red                                 │
│ ████████████████████ 50% (5 votes)  │
├─────────────────────────────────────┤
│ Blue                                │
│ ████████████ 30% (3 votes)          │
├─────────────────────────────────────┤
│ Green                               │
│ ████████ 20% (2 votes)              │
└─────────────────────────────────────┘

[Export Results] [Back to Mainboard]
```

---

## 4. Implementation Details

### 4.1 Board Service Extensions
**File**: `board.service.ts`

**New Methods**:
```typescript
// Create/Update Poll
async createPoll(boardKey: string, pollData: PollData): Promise<void>
async updatePoll(boardKey: string, pollData: PollData): Promise<void>
async getPoll(boardKey: string): Promise<PollData | null>

// Voting
async voteOnPoll(boardKey: string, optionIds: string[], ip: string): Promise<void>
async hasVotedOnPoll(boardKey: string, ip: string): Promise<boolean>
async getPollVoteCount(boardKey: string): Promise<number>
async canVoteOnPoll(boardKey: string, email?: string): Promise<boolean> // Check board protection

// Poll Analytics (for creators)
async getAllPollVotes(boardKey: string): Promise<PollVote[]>
async getPollVoteStats(boardKey: string): Promise<{
  totalVotes: number;
  votesByOption: { optionId: string; count: number; percentage: number }[];
  votesOverTime: { date: string; count: number }[];
}>

// Real-time subscriptions
subscribeToPollUpdates(boardKey: string, callback: (poll: PollData) => void): Unsubscribe
```

### 4.2 Component Changes

#### Mainboard Component
- Add poll mode toggle
- Add poll editor component
- Handle poll creation/editing
- Save poll data to board

#### Subboard Component
- Detect `boardType === 'poll'`
- Check board protection (reuse existing logic)
- Render poll interface conditionally
- Handle voting logic
- Display results with visual bars
- Respect board protection for voting access

### 4.3 New Components

#### Poll Editor Component
**File**: `poll-editor/poll-editor.component.ts`
- Form for creating/editing polls
- Dynamic option management
- Validation (min 2 options, max 5)
- Integrate with existing board protection

#### Poll Display Component
**File**: `poll-display/poll-display.component.ts`
- Display poll question
- Render voting interface
- Show results with progress bars
- Handle vote submission
- Check board protection before allowing votes

#### Poll Results/Analytics Component
**File**: `poll-results/poll-results.component.ts`
- Dedicated page for poll creators
- Route: `/poll/{boardKey}/results`
- Display detailed vote statistics
- Visual charts and graphs
- Vote breakdown by option
- Total votes and percentages
- Accessible only to board owner

---

## 5. Voting Logic

### 5.1 Vote Tracking
- Use localStorage to track voted polls (similar to current voting system)
- Store: `{ boardKey: string, optionIds: string[], timestamp: number }`
- Check localStorage before allowing vote
- If `allowVoteChange === true`, allow updating vote

### 5.2 Vote Counting
- Each vote increments `option.voteCount`
- Total votes = sum of all option vote counts
- Calculate percentages: `(option.voteCount / totalVotes) * 100`

### 5.3 Real-time Updates
- Subscribe to poll data changes
- Update vote counts live
- Re-render results when votes change

### 5.4 Board Protection for Polls
- Reuse existing `boardProtection` and `authorizedMailList` from Board interface
- When `boardProtection === true`:
  - Only users with emails in `authorizedMailList` can vote
  - Unauthorized users see poll question and options but cannot vote
  - Show message: "This poll is protected. Only authorized users can vote."
- When `boardProtection === false`:
  - Anyone can vote (public poll)
- Protection check happens before vote submission
- Same email validation logic as existing board protection

---

## 6. Visual Design

### 6.1 Poll Creation (Mainboard)
- Clean form layout
- Material Design components
- Color-coded options (optional)
- Drag-and-drop option reordering (future enhancement)

### 6.2 Poll Display (Subboard)
- Large, readable poll question
- Clear option buttons/checkboxes
- Visual progress bars for results
- Responsive design (mobile-friendly)
- Smooth animations for vote updates

### 6.3 Color Scheme
- Use Material Design colors
- Option colors can be customizable
- Progress bars: Primary color
- Vote buttons: Accent color

---

## 7. Edge Cases & Validation

### 7.1 Validation Rules
- Poll question: Required, max 200 characters
- Options: Minimum 2, maximum 5
- Option text: Required, max 100 characters each
- End date: Must be in future (if provided)
- Board protection: Reuse existing board protection logic

### 7.2 Edge Cases
- User tries to vote twice (check localStorage)
- Poll has no votes yet (show 0% for all options)
- Poll ended (disable voting, show final results)
- User changes vote (if allowed, update counts)
- Network error during vote (show error, retry option)
- Protected poll: Only authorized emails can vote
- Unauthorized user tries to vote (show error message)
- Poll creator viewing results (verify ownership)

### 7.3 Migration
- Existing boards remain `boardType: undefined` (treated as standard)
- Only new polls have `boardType: 'poll'`
- No breaking changes to existing boards

---

## 8. Testing Considerations

### 8.1 Unit Tests
- Poll creation validation
- Vote counting logic
- Percentage calculations
- Vote change logic

### 8.2 Integration Tests
- Create poll → View poll → Vote → See results
- Multiple users voting simultaneously
- Real-time updates
- Vote change flow

### 8.3 User Testing
- Poll creation usability
- Voting interface clarity
- Results visualization
- Mobile responsiveness

---

## 9. Future Enhancements (Not in Initial Implementation)

1. **Poll Analytics**: View detailed voting statistics
2. **Poll Templates**: Pre-made poll templates
3. **Poll Sharing**: Share poll on social media
4. **Poll Export**: Export results as CSV/PDF
5. **Advanced Options**:
   - Image options (not just text)
   - Ranked choice voting
   - Weighted voting
   - Anonymous vs named votes
6. **Poll Categories**: Organize polls by category
7. **Poll Search**: Search polls by question/keyword

---

## 10. Implementation Phases

### Phase 1: Core Structure
- [ ] Add `boardType` and `pollData` to Board interface
- [ ] Create PollData, PollOption, PollVote interfaces
- [ ] Update BoardService with poll methods
- [ ] Firebase structure setup

### Phase 2: Poll Creation
- [ ] Add poll mode toggle in mainboard
- [ ] Create poll editor component
- [ ] Implement poll creation/editing
- [ ] Save poll data to board

### Phase 3: Poll Display
- [ ] Detect poll board type in subboard
- [ ] Create poll display component
- [ ] Render poll question and options
- [ ] Implement voting interface

### Phase 4: Voting System
- [ ] Implement vote submission
- [ ] Vote tracking (localStorage)
- [ ] Vote counting and updates
- [ ] Real-time vote count updates

### Phase 5: Results Display
- [ ] Results visualization (progress bars)
- [ ] Percentage calculations
- [ ] Show results based on settings
- [ ] Vote change functionality

### Phase 6: Poll Analytics Page
- [ ] Create poll results component
- [ ] Add route `/poll/{boardKey}/results`
- [ ] Verify board ownership
- [ ] Display detailed vote statistics
- [ ] Visual charts/graphs
- [ ] Link from mainboard

### Phase 7: Board Protection Integration
- [ ] Integrate poll with existing board protection
- [ ] Check authorization before allowing votes
- [ ] Show appropriate error messages
- [ ] Test protected poll flow

### Phase 8: Polish & Testing
- [ ] Mobile responsiveness
- [ ] Error handling
- [ ] Loading states
- [ ] User testing
- [ ] Bug fixes

---

## 11. Questions to Resolve

1. **Default Poll Type**: Single choice or multiple choice?
2. **Default Show Results**: Always, after-vote, or never?
3. **Max Options**: ✅ **RESOLVED**: Maximum 5 options
4. **Option Colors**: Auto-assign colors or let user choose?
5. **Vote Change**: Default to allow or disallow?
6. **Poll End Date**: Required or optional?
7. **Poll Analytics**: ✅ **RESOLVED**: Separate page for poll creators
8. **Poll Protection**: ✅ **RESOLVED**: Use existing board protection system
9. **Poll History**: Keep old polls or allow deletion only?

---

## 12. Technical Decisions

### Decision 1: Board Type vs Separate Collection
**Decision**: Extend existing Board interface with optional `pollData`
**Rationale**: 
- Keeps all boards in one place
- Easier to manage
- No need for separate routing
- Can reuse existing board features (protection, size, etc.)

### Decision 2: Vote Storage
**Decision**: Store votes in separate `/pollVotes` collection
**Rationale**:
- Keeps board data clean
- Easier to query vote history
- Can analyze votes separately
- Better performance

### Decision 3: Real-time Updates
**Decision**: Use Firebase real-time listeners
**Rationale**:
- Consistent with existing system
- Automatic updates
- Better user experience
- No polling needed

### Decision 4: Poll Protection
**Decision**: Reuse existing board protection system
**Rationale**:
- Consistent user experience
- No need for separate protection logic
- Authorized emails can vote
- Unauthorized users see error message

### Decision 5: Poll Analytics
**Decision**: Separate page for poll creators
**Rationale**:
- Clean separation of concerns
- Better UX for detailed analytics
- Can add more features later (export, charts)
- Only accessible to board owner

---

## Next Steps

1. Review and approve this plan
2. Answer questions in Section 11
3. Start with Phase 1 implementation
4. Iterate based on feedback

