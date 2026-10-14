import { GuidesIndexView, guidesMetadata } from "@/components/site/Marketing";
import { searchProduct } from "@/lib/products";

export const revalidate = 3600;
export const generateMetadata = () => guidesMetadata(searchProduct());

export default function Page() {
  return <GuidesIndexView product={searchProduct()} />;
}
