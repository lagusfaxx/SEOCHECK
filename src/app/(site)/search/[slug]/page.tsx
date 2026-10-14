import { notFound } from "next/navigation";
import { FeaturePageView, featureMetadata } from "@/components/site/Marketing";
import { searchProduct } from "@/lib/products";
import { FEATURE_PAGES, featureBySlug } from "@/lib/search-marketing";

export const dynamicParams = false;
export const revalidate = 3600;
export const generateStaticParams = () => FEATURE_PAGES.map((f) => ({ slug: f.slug }));
export const generateMetadata = ({ params }: { params: { slug: string } }) => featureMetadata(searchProduct(), featureBySlug(params.slug), "/brand/fsv-search-dashboard.png");

/** Página de una función de FSV Search: posiciona su búsqueda propia ("auditoría SEO", "seguimiento de rankings"…). */
export default function Page({ params }: { params: { slug: string } }) {
  const f = featureBySlug(params.slug);
  if (!f) notFound();
  return <FeaturePageView product={searchProduct()} page={f} />;
}
