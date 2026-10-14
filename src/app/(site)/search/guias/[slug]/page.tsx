import { notFound } from "next/navigation";
import { GuideView, guideMetadata } from "@/components/site/Marketing";
import { searchProduct } from "@/lib/products";
import { GUIDES, guideBySlug } from "@/lib/search-marketing";

const IMG = "/brand/fsv-search-dashboard.png";
export const dynamicParams = false;
export const revalidate = 3600;
export const generateStaticParams = () => GUIDES.map((g) => ({ slug: g.slug }));
export const generateMetadata = ({ params }: { params: { slug: string } }) => guideMetadata(searchProduct(), guideBySlug(params.slug), IMG);

/** Guía de SEO: atrae búsquedas informativas y lleva a la función relacionada. */
export default function Page({ params }: { params: { slug: string } }) {
  const g = guideBySlug(params.slug);
  if (!g) notFound();
  return <GuideView product={searchProduct()} guide={g} img={IMG} />;
}
