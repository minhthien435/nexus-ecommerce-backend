export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  level: number;
  sortOrder: number;
  isActive: boolean;
  parentId: string | null;
  children: CategoryTreeNode[];
}
