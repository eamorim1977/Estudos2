export interface StudyContent {
  id: string;
  text: string;
}

export interface Subject {
  id: string;
  name: string;
  content: StudyContent[];
}

export interface DailyReview {
    subjectId: string;
    contentId: string;
    date: string;
}

export interface ReviewItem {
    subjectId: string;
    contentId: string;
}